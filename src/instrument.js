import difference from 'lodash/array/difference';

export const ActionTypes = {
  PERFORM_ACTION: 'PERFORM_ACTION',
  RESET: 'RESET',
  ROLLBACK: 'ROLLBACK',
  COMMIT: 'COMMIT',
  SWEEP: 'SWEEP',
  TOGGLE_ACTION: 'TOGGLE_ACTION',
  JUMP_TO_STATE: 'JUMP_TO_STATE',
  IMPORT_STATE: 'IMPORT_STATE'
};

/**
 * Action creators to change the History state.
 */
export const ActionCreators = {
  performAction(action) {
    return { type: ActionTypes.PERFORM_ACTION, action, timestamp: Date.now() };
  },

  reset() {
    return { type: ActionTypes.RESET, timestamp: Date.now() };
  },

  rollback() {
    return { type: ActionTypes.ROLLBACK, timestamp: Date.now() };
  },

  commit() {
    return { type: ActionTypes.COMMIT, timestamp: Date.now() };
  },

  sweep() {
    return { type: ActionTypes.SWEEP };
  },

  toggleAction(id) {
    return { type: ActionTypes.TOGGLE_ACTION, id };
  },

  jumpToState(index) {
    return { type: ActionTypes.JUMP_TO_STATE, index };
  },

  importState(nextLiftedState) {
    return { type: ActionTypes.IMPORT_STATE, nextLiftedState };
  }
};

const INIT_ACTION = { type: '@@INIT' };

/**
 * Computes the next entry in the log by applying an action.
 */
function computeNextEntry(reducer, action, state, error) {
  if (error) {
    return {
      state,
      error: 'Interrupted by an error up the chain'
    };
  }

  let nextState = state;
  let nextError;
  try {
    nextState = reducer(state, action);
  } catch (err) {
    nextError = err.toString();
    console.error(err.stack || err);
  }

  return {
    state: nextState,
    error: nextError
  };
}

/**
 * Runs the reducer on all actions to get a fresh computation log.
 */
function recomputeStates(reducer, committedState, actionsById, stagedActionIds, skippedActionIds) {
  const computedStates = [];
  for (let i = 0; i < stagedActionIds.length; i++) {
    const actionId = stagedActionIds[i];
    const action = actionsById[actionId].action;

    const previousEntry = computedStates[i - 1];
    const previousState = previousEntry ? previousEntry.state : committedState;
    const previousError = previousEntry ? previousEntry.error : undefined;

    const shouldSkip = skippedActionIds.indexOf(actionId) > -1;
    const entry = shouldSkip ?
      previousEntry :
      computeNextEntry(reducer, action, previousState, previousError);

    computedStates.push(entry);
  }

  return computedStates;
}

/**
 * Lifts an app's action into an action on the lifted store.
 */
function liftAction(action) {
  return ActionCreators.performAction(action);
}

/**
 * Creates a history state reducer from an app's reducer.
 */
function liftReducerWith(reducer, initialCommittedState, monitorReducer) {
  const initialLiftedState = {
    monitorState: monitorReducer(undefined, {}),
    nextActionId: 1,
    actionsById: {
      0: liftAction(INIT_ACTION)
    },
    stagedActionIds: [0],
    skippedActionIds: [],
    committedState: initialCommittedState,
    currentStateIndex: 0,
    computedStates: undefined
  };

  /**
   * Manages how the history actions modify the history state.
   */
  return (liftedState = initialLiftedState, liftedAction) => {
    let shouldRecomputeStates = true;
    let {
      monitorState,
      actionsById,
      nextActionId,
      stagedActionIds,
      skippedActionIds,
      committedState,
      currentStateIndex,
      computedStates
    } = liftedState;

    switch (liftedAction.type) {
    case ActionTypes.RESET:
      actionsById = {
        0: liftAction(INIT_ACTION)
      };
      nextActionId = 1;
      stagedActionIds = [0];
      skippedActionIds = [];
      committedState = initialCommittedState;
      currentStateIndex = 0;
      break;
    case ActionTypes.COMMIT:
      actionsById = {
        0: liftAction(INIT_ACTION)
      };
      nextActionId = 1;
      stagedActionIds = [0];
      skippedActionIds = [];
      committedState = computedStates[currentStateIndex].state;
      currentStateIndex = 0;
      break;
    case ActionTypes.ROLLBACK:
      actionsById = {
        0: liftAction(INIT_ACTION)
      };
      nextActionId = 1;
      stagedActionIds = [0];
      skippedActionIds = [];
      currentStateIndex = 0;
      break;
    case ActionTypes.TOGGLE_ACTION:
      const index = skippedActionIds.indexOf(liftedAction.id);
      if (index === -1) {
        skippedActionIds = [
          liftedAction.id,
          ...skippedActionIds
        ];
      } else {
        skippedActionIds = [
          ...skippedActionIds.slice(0, index),
          ...skippedActionIds.slice(index + 1)
        ];
      }
      break;
    case ActionTypes.JUMP_TO_STATE:
      currentStateIndex = liftedAction.index;
      // Optimization: we know the history has not changed.
      shouldRecomputeStates = false;
      break;
    case ActionTypes.SWEEP:
      stagedActionIds = difference(stagedActionIds, skippedActionIds);
      skippedActionIds = [];
      currentStateIndex = Math.min(currentStateIndex, stagedActionIds.length - 1);
      break;
    case ActionTypes.PERFORM_ACTION:
      if (currentStateIndex === stagedActionIds.length - 1) {
        currentStateIndex++;
      }

      const actionId = nextActionId++;
      // Mutation! This is the hottest path, and we optimize on purpose.
      // It is safe because we set a new key in a cache dictionary.
      actionsById[actionId] = liftedAction;
      stagedActionIds = [...stagedActionIds, actionId];
      // Optimization: we know that the past has not changed.
      shouldRecomputeStates = false;
      // Instead of recomputing the states, append the next one.
      const previousEntry = computedStates[computedStates.length - 1];
      const nextEntry = computeNextEntry(
        reducer,
        liftedAction.action,
        previousEntry.state,
        previousEntry.error
      );
      computedStates = [...computedStates, nextEntry];
      break;
    case ActionTypes.IMPORT_STATE:
      ({
        monitorState,
        actionsById,
        nextActionId,
        stagedActionIds,
        skippedActionIds,
        committedState,
        currentStateIndex,
        computedStates
      } = liftedAction.nextLiftedState);
      break;
    case '@@redux/INIT':
      // Always recompute states on hot reload and init.
      shouldRecomputeStates = true;
      break;
    default:
      // Optimization: a monitor action can't change history.
      shouldRecomputeStates = false;
      break;
    }

    if (shouldRecomputeStates) {
      computedStates = recomputeStates(
        reducer,
        committedState,
        actionsById,
        stagedActionIds,
        skippedActionIds
      );
    }

    monitorState = monitorReducer(monitorState, liftedAction);

    return {
      monitorState,
      actionsById,
      nextActionId,
      stagedActionIds,
      skippedActionIds,
      committedState,
      currentStateIndex,
      computedStates
    };
  };
}

/**
 * Provides an app's view into the state of the lifted store.
 */
function unliftState(liftedState) {
  const { computedStates, currentStateIndex } = liftedState;
  const { state } = computedStates[currentStateIndex];
  return state;
}

/**
 * Provides an app's view into the lifted store.
 */
function unliftStore(liftedStore, liftReducer) {
  let lastDefinedState;

  return {
    ...liftedStore,

    liftedStore,

    dispatch(action) {
      liftedStore.dispatch(liftAction(action));
      return action;
    },

    getState() {
      const state = unliftState(liftedStore.getState());
      if (state !== undefined) {
        lastDefinedState = state;
      }
      return lastDefinedState;
    },

    replaceReducer(nextReducer) {
      liftedStore.replaceReducer(liftReducer(nextReducer));
    }
  };
}

/**
 * Redux instrumentation store enhancer.
 */
export default function instrument(monitorReducer = () => null) {
  return createStore => (reducer, initialState) => {
    function liftReducer(r) {
      return liftReducerWith(r, initialState, monitorReducer);
    }

    const liftedStore = createStore(liftReducer(reducer));
    return unliftStore(liftedStore, liftReducer);
  };
}
