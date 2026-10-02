// Transient held buttons, shared by the DOM controls and the camera without React frame updates.
export const walkInput = { forward: 0, right: 0, turn: 0 };
export function clearWalkInput(): void { walkInput.forward=0; walkInput.right=0; walkInput.turn=0; }
