//
// `ClientAction` variant indices, read from the deployed pool's own ABI: the enum member order IS
// the serde discriminant the span guards (`action-span.ts` and its callers) match on.
//

export const CLIENT_ACTION = {
  SetViewingKey: 0,
  OpenChannel: 1,
  OpenSubchannel: 2,
  CreateEncNote: 3,
  CreateOpenNote: 4,
  Deposit: 5,
  UseNote: 6,
  Withdraw: 7,
  InvokeExternal: 8,
  ComputeAndInvoke: 9,
} as const
