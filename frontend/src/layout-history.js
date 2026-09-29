// layout-history.js — Keep the last 20 layout edits in temporary component memory.
// Undo restores geometry and labels; session cleanup discards the whole history.
export function layoutHistory(state, action) {
  if(action.type==='set')return {...state,present:typeof action.value==='function'?action.value(state.present):action.value};
  if(action.type==='undo')return state.past.length?{present:state.past.at(-1),past:state.past.slice(0,-1)}:state;
  if(action.type==='edit')return {present:action.fn(state.present),past:action.record===false?state.past:[...state.past,state.present].slice(-20)};
  return state;
}
