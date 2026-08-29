const register = jest.fn();
const pair = jest.fn();
const pairingPin = jest.fn();
const rotatePairingPin = jest.fn();
const unregister = jest.fn();
const get = jest.fn();
const start = jest.fn();
const stop = jest.fn();
const browse = jest.fn();
const load = jest.fn();

export const clientManagerMock = {
  register,
  pair,
  pairingPin,
  rotatePairingPin,
  unregister,
  get,
  start,
  stop,
  browse,
  load,
};

jest.mock("./client-manager", () => ({
  clientManager: clientManagerMock,
}));
