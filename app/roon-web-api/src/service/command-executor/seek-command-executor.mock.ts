const executor = jest.fn();

export const seekCommandExecutorMock = executor;

jest.mock("./seek-command-executor", () => ({
  executor,
}));
