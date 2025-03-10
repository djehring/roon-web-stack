import { EventSourceMock, eventSourceMockConstructor, eventSourceMocks, resetEventSourceMocks } from "@mock";

import fetchMock, { enableFetchMocks, MockResponseInit, MockResponseInitFunction } from "jest-fetch-mock";
import {
  ApiState,
  ClientRoonApiBrowseLoadOptions,
  ClientRoonApiBrowseOptions,
  ClientState,
  ClientStateListener,
  Command,
  CommandResult,
  CommandState,
  CommandStateListener,
  CommandType,
  Item,
  ItemIndexSearch,
  Ping,
  QueueState,
  QueueStateListener,
  RoonApiBrowseLoadOptions,
  RoonApiBrowseLoadResponse,
  RoonApiBrowseOptions,
  RoonApiBrowseResponse,
  RoonPath,
  RoonState,
  RoonStateListener,
  SharedConfig,
  SharedConfigListener,
  ZoneState,
  ZoneStateListener,
} from "@model";
import { roonWebClientFactory } from "./roon-web-client-factory";

const API_URL = new URL("http://test.test:3000");

describe("roon-web-client-factory.ts test suite", () => {
  let roonStateListener: RoonStateListener;
  let publishedRoonStates: ApiState[];
  let commandStateListener: CommandStateListener;
  let publishedCommandStates: CommandState[];
  let zoneStateListener: ZoneStateListener;
  let publishedZoneStates: ZoneState[];
  let queueStateListener: QueueStateListener;
  let publishedQueueStates: QueueState[];
  let clientStateListener: ClientStateListener;
  let publishedClientStates: ClientState[];
  let sharedConfigListener: SharedConfigListener;
  let publishedSharedConfig: SharedConfig[];
  beforeEach(() => {
    enableFetchMocks();
    Object.defineProperty(global, "fetch", {
      writable: true,
      value: fetchMock,
    });
    fetchMock.resetMocks();
    resetEventSourceMocks();
    publishedRoonStates = [];
    roonStateListener = (state: ApiState) => {
      publishedRoonStates.push(state);
    };
    publishedCommandStates = [];
    commandStateListener = (commandState: CommandState) => {
      publishedCommandStates.push(commandState);
    };
    publishedZoneStates = [];
    zoneStateListener = (state: ZoneState) => {
      publishedZoneStates.push(state);
    };
    publishedQueueStates = [];
    queueStateListener = (state: QueueState) => {
      publishedQueueStates.push(state);
    };
    publishedClientStates = [];
    clientStateListener = (state: ClientState) => {
      publishedClientStates.push(state);
    };
    publishedSharedConfig = [];
    sharedConfigListener = (sharedConfig: SharedConfig) => {
      publishedSharedConfig.push(sharedConfig);
    };
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("roonWebClientFactory#build should return a new RoonWebClient at each call", () => {
    const firstClient = roonWebClientFactory.build(API_URL);
    expect(firstClient).not.toBeUndefined();
    const secondClient = roonWebClientFactory.build(API_URL);
    expect(secondClient).not.toBeUndefined();
    expect(firstClient).not.toBe(secondClient);
  });

  it("RoonWebClient should throw an Error if any method other than listener on and off is called before calling #start", () => {
    const error = new Error("client has not been started");
    const client = roonWebClientFactory.build(API_URL);
    expect(() => {
      client.onRoonState(roonStateListener);
    }).not.toThrow(error);
    expect(() => {
      client.onCommandState(commandStateListener);
    }).not.toThrow(error);
    expect(() => {
      client.onZoneState(zoneStateListener);
    }).not.toThrow(error);
    expect(() => {
      client.onQueueState(queueStateListener);
    }).not.toThrow(error);
    expect(() => {
      client.offRoonState(roonStateListener);
    }).not.toThrow(error);
    expect(() => {
      client.offCommandState(commandStateListener);
    }).not.toThrow(error);
    expect(() => {
      client.offZoneState(zoneStateListener);
    }).not.toThrow(error);
    expect(() => {
      client.offQueueState(queueStateListener);
    }).not.toThrow(error);
    expect(() => {
      client.onClientState(clientStateListener);
    }).not.toThrow(error);
    expect(() => {
      client.offClientState(clientStateListener);
    }).not.toThrow(error);
    expect(() => {
      client.version();
    }).toThrow(error);
    void expect(client.stop()).rejects.toEqual(error);
    void expect(client.restart()).rejects.toEqual(error);
    void expect(client.command(COMMAND)).rejects.toEqual(error);
    void expect(client.browse({} as unknown as ClientRoonApiBrowseOptions)).rejects.toEqual(error);
    void expect(client.load({} as unknown as ClientRoonApiBrowseLoadOptions)).rejects.toEqual(error);
  });

  it(
    "RoonWebClient#start should call GET '/api/version', call POST '/api/register', save the returned Location header as client_path, " +
      "load Explore and Library item_key and open an EventSource on '${client_path}/events' and " +
      "publish the 'started' clientState",
    async () => {
      fetchMock.once(mockVersionGet).once(mockRegisterPost);
      const client = roonWebClientFactory.build(API_URL);
      client.onClientState(clientStateListener);
      await client.start();
      expect(fetchMock.mock.calls).toHaveLength(2);
      const versionUrl = new URL("/api/version", API_URL);
      const versionRequest = fetchMock.mock.calls[0][0] as Request;
      expect(versionRequest.url).toEqual(versionUrl.toString());
      expect(versionRequest.method).toEqual("GET");
      const registerUrl = new URL("/api/register", API_URL);
      const registerRequest = fetchMock.mock.calls[1][0] as Request;
      expect(registerRequest.url).toEqual(registerUrl.toString());
      expect(registerRequest.method).toEqual("POST");
      expect(registerRequest.headers.get("Accept")).toEqual("application/json");
      expect(eventSourceMocks.size).toEqual(1);
      expect(eventSourceMocks.has(EVENTS_URL.toString())).toBe(true);
      expect(eventSourceMockConstructor).toHaveBeenCalledTimes(1);
      expect(eventSourceMockConstructor).toHaveBeenCalledWith(EVENTS_URL);
      const eventSourceMock: EventSourceMock | undefined = eventSourceMocks.get(EVENTS_URL.toString());
      expect(eventSourceMock?.onerror).not.toBeUndefined();
      expect(eventSourceMock?.getEventListener("state")).not.toBeUndefined();
      expect(eventSourceMock?.getEventListener("command_state")).not.toBeUndefined();
      expect(eventSourceMock?.getEventListener("zone")).not.toBeUndefined();
      expect(eventSourceMock?.getEventListener("queue")).not.toBeUndefined();
      expect(publishedClientStates).toHaveLength(1);
      expect(publishedClientStates).toEqual([
        {
          status: "started",
          roonClientId: "client_id",
        },
      ]);
    }
  );

  it("RoonWebClient#start should use provided roonClientId, if present, during call to '/api/register'", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    client.onClientState(clientStateListener);
    await client.start(other_client_id);
    expect(fetchMock.mock.calls).toHaveLength(2);
    const registerUrl = new URL("/api/register/" + other_client_id, API_URL);
    const registerRequest = fetchMock.mock.calls[1][0] as Request;
    expect(registerRequest.url).toEqual(registerUrl.toString());
    expect(eventSourceMocks.size).toEqual(1);
    const eventsUrl = new URL(other_client_path + "/events", API_URL);
    expect(eventSourceMocks.has(eventsUrl.toString())).toBe(true);
    expect(eventSourceMockConstructor).toHaveBeenCalledTimes(1);
    expect(eventSourceMockConstructor).toHaveBeenCalledWith(eventsUrl);
    expect(publishedClientStates).toHaveLength(1);
    expect(publishedClientStates).toEqual([
      {
        status: "started",
        roonClientId: other_client_id,
      },
    ]);
  });

  it("RoonWebClient#start should return a rejected Promise without calling POST '/api/register' if any error occurred during the call of GET '/api/version'", () => {
    const error = new Error("network error");
    fetchMock.once((): Promise<MockResponseInit> => Promise.reject(error));
    const client = roonWebClientFactory.build(API_URL);
    const startPromise = client.start();
    void expect(startPromise).rejects.toEqual(error);
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("RoonWebClient#start should return a rejected Promise without calling POST '/api/register' if the status of the response of GET '/api/version' is not 204", () => {
    fetchMock.once((req: Request): Promise<MockResponseInit> => {
      if (req.method === "GET" && req.url === new URL("/api/version", API_URL).toString()) {
        return Promise.resolve({
          headers: {
            "x-roon-web-stack-version": "version",
          },
          status: 200,
        });
      } else {
        return Promise.reject(new Error("error"));
      }
    });
    const client = roonWebClientFactory.build(API_URL);
    const startPromise = client.start();
    void expect(startPromise).rejects.toEqual(new Error("unable to validate roon-web-stack version"));
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("RoonWebClient#start should return a rejected Promise without calling POST '/api/register' if the response of GET '/api/version' does not have a 'x-roon-web-stack-version' header", () => {
    fetchMock.once((req: Request): Promise<MockResponseInit> => {
      if (req.method === "GET" && req.url === new URL("/api/version", API_URL).toString()) {
        return Promise.resolve({
          status: 204,
        });
      } else {
        return Promise.reject(new Error("error"));
      }
    });
    const client = roonWebClientFactory.build(API_URL);
    const startPromise = client.start();
    void expect(startPromise).rejects.toEqual(new Error("unable to validate roon-web-stack version"));
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("RoonWebClient#start should return a rejected Promise without calling '${client_path}/events' if any error occurred during the call of POST '/api/register'", () => {
    const error = new Error("network error");
    fetchMock.once(mockVersionGet).once((): Promise<MockResponseInit> => Promise.reject(error));
    const client = roonWebClientFactory.build(API_URL);
    const startPromise = client.start();
    void expect(startPromise).rejects.toEqual(error);
    expect(eventSourceMocks.size).toEqual(0);
  });

  it("RoonWebClient#start should return a rejected Promise without calling '${client_path}/events' if the status of the response of POST '/api/register' is not 201", () => {
    fetchMock.once(mockVersionGet).once((req: Request): Promise<MockResponseInit> => {
      if (req.method === "POST" && req.url === new URL("/api/register", API_URL).toString()) {
        return Promise.resolve({
          headers: {
            Location: client_path,
          },
          status: 200,
        });
      } else {
        return Promise.reject(new Error("error"));
      }
    });
    const client = roonWebClientFactory.build(API_URL);
    const startPromise = client.start();
    void expect(startPromise).rejects.toEqual(new Error("unable to register client"));
    expect(eventSourceMocks.size).toEqual(0);
  });

  it("RoonWebClient#start should return a rejected Promise without calling '${client_path}/events' if the response of POST '/api/register' does not have a 'Location' header", () => {
    fetchMock.once(mockVersionGet).once((req: Request): Promise<MockResponseInit> => {
      if (req.method === "POST" && req.url === new URL("/api/register", API_URL).toString()) {
        return Promise.resolve({
          status: 201,
        });
      } else {
        return Promise.reject(new Error("error"));
      }
    });
    const client = roonWebClientFactory.build(API_URL);
    const startPromise = client.start();
    void expect(startPromise).rejects.toEqual(new Error("unable to register client"));
    expect(eventSourceMocks.size).toEqual(0);
  });

  it("RoonWebClient#onRoonState should always replay the last known ApiState and forward incoming events", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendStateEvent(
      {
        state: RoonState.LOST,
        zones: [],
        outputs: [],
      },
      eventSourceMock
    );
    sendStateEvent(
      {
        state: RoonState.SYNCING,
        zones: [],
        outputs: [],
      },
      eventSourceMock
    );
    sendStateEvent(SYNC_API_STATE_WITH_TWO_ZONES, eventSourceMock);
    client.onRoonState(roonStateListener);
    expect(publishedRoonStates).toHaveLength(1);
    expect(publishedRoonStates).toEqual([SYNC_API_STATE_WITH_TWO_ZONES]);
    sendStateEvent(
      {
        state: RoonState.LOST,
        zones: [],
        outputs: [],
      },
      eventSourceMock
    );
    sendStateEvent(
      {
        state: RoonState.SYNCING,
        zones: [],
        outputs: [],
      },
      eventSourceMock
    );
    sendStateEvent(SYNC_API_STATE_WITH_TWO_ZONES, eventSourceMock);
    expect(publishedRoonStates).toEqual([
      SYNC_API_STATE_WITH_TWO_ZONES,
      {
        state: RoonState.LOST,
        zones: [],
        outputs: [],
      },
      {
        state: RoonState.SYNCING,
        zones: [],
        outputs: [],
      },
      SYNC_API_STATE_WITH_TWO_ZONES,
    ]);
    client.onRoonState((state: ApiState) => {
      expect(state).toEqual(SYNC_API_STATE_WITH_TWO_ZONES);
    });
  });

  it("RoonWebClient#onRoonState should gracefully ignore incoming events with malformed JSON", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendStateEvent(SYNC_API_STATE_WITH_TWO_ZONES, eventSourceMock);
    client.onRoonState(roonStateListener);
    expect(publishedRoonStates).toHaveLength(1);
    eventSourceMock?.dispatchEvent(
      new MessageEvent<string>("state", {
        data: "{",
      })
    );
    expect(publishedRoonStates).toHaveLength(1);
    expect(publishedRoonStates[0]).toEqual(SYNC_API_STATE_WITH_TWO_ZONES);
  });

  it("RoonWebClient#offRoonState should unregister the given RoonStateListener without impact on the other registered listeners", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    client.onRoonState(roonStateListener);
    const otherPublishedRoonStates: ApiState[] = [];
    const otherListener: RoonStateListener = (state: ApiState) => {
      otherPublishedRoonStates.push(state);
    };
    client.onRoonState(otherListener);
    sendStateEvent(SYNC_API_STATE_WITH_TWO_ZONES, eventSourceMock);
    expect(publishedRoonStates).toHaveLength(2);
    expect(otherPublishedRoonStates).toHaveLength(2);
    client.offRoonState(roonStateListener);
    sendStateEvent(
      {
        state: RoonState.LOST,
        zones: [],
        outputs: [],
      },
      eventSourceMock
    );
    expect(publishedRoonStates).toHaveLength(2);
    expect(otherPublishedRoonStates).toHaveLength(3);
  });

  it("RoonWebClient#offRoonState should ignore silently unregistered listeners", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    const otherPublishedRoonStates: ApiState[] = [];
    const otherListener: RoonStateListener = (state: ApiState) => {
      otherPublishedRoonStates.push(state);
    };
    client.onRoonState(otherListener);
    sendStateEvent(SYNC_API_STATE_WITH_TWO_ZONES, eventSourceMock);
    expect(otherPublishedRoonStates).toHaveLength(2);
    client.offRoonState(roonStateListener);
    sendStateEvent(
      {
        state: RoonState.LOST,
        zones: [],
        outputs: [],
      },
      eventSourceMock
    );
    expect(otherPublishedRoonStates).toHaveLength(3);
  });

  it("RoonWebClient#onCommandState should never replay the last known CommandState and just forward incoming events", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendCommandStateEvent(
      {
        state: CommandResult.APPLIED,
        command_id: "command_id",
      },
      eventSourceMock
    );
    sendCommandStateEvent(
      {
        state: CommandResult.APPLIED,
        command_id: "command_id",
      },
      eventSourceMock
    );
    client.onCommandState(commandStateListener);
    expect(publishedCommandStates).toHaveLength(0);
    sendCommandStateEvent(
      {
        state: CommandResult.APPLIED,
        command_id: "command_id",
      },
      eventSourceMock
    );
    sendCommandStateEvent(
      {
        state: CommandResult.APPLIED,
        command_id: "other_command_id",
      },
      eventSourceMock
    );
    expect(publishedCommandStates).toHaveLength(2);
    expect(publishedCommandStates).toEqual([
      {
        state: CommandResult.APPLIED,
        command_id: "command_id",
      },
      {
        state: CommandResult.APPLIED,
        command_id: "other_command_id",
      },
    ]);
  });

  it("RoonWebClient#onCommandState should gracefully ignore incoming events with malformed JSON", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendCommandStateEvent(
      {
        state: CommandResult.APPLIED,
        command_id: "command_id",
      },
      eventSourceMock
    );
    client.onCommandState(commandStateListener);
    expect(publishedRoonStates).toHaveLength(0);
    eventSourceMock?.dispatchEvent(
      new MessageEvent<string>("state", {
        data: "{",
      })
    );
    expect(publishedRoonStates).toHaveLength(0);
  });

  it("RoonWebClient#offCommandState should unregister the given CommandStateListener without impact on the other registered listeners", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    client.onCommandState(commandStateListener);
    const otherPublishedCommandStates: CommandState[] = [];
    const otherListener: CommandStateListener = (state: CommandState) => {
      otherPublishedCommandStates.push(state);
    };
    client.onCommandState(otherListener);
    sendCommandStateEvent(
      {
        state: CommandResult.APPLIED,
        command_id: "command_id",
      },
      eventSourceMock
    );
    expect(publishedCommandStates).toHaveLength(1);
    expect(otherPublishedCommandStates).toHaveLength(1);
    client.offCommandState(commandStateListener);
    sendCommandStateEvent(
      {
        state: CommandResult.REJECTED,
        command_id: "other_command_id",
      },
      eventSourceMock
    );
    expect(publishedCommandStates).toHaveLength(1);
    expect(otherPublishedCommandStates).toHaveLength(2);
  });

  it("RoonWebClient#offCommandState should ignore silently unregistered listeners", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    const otherPublishedCommandStates: CommandState[] = [];
    const otherListener: CommandStateListener = (state: CommandState) => {
      otherPublishedCommandStates.push(state);
    };
    client.onCommandState(otherListener);
    sendCommandStateEvent(
      {
        state: CommandResult.APPLIED,
        command_id: "command_id",
      },
      eventSourceMock
    );
    expect(otherPublishedCommandStates).toHaveLength(1);
    client.offCommandState(commandStateListener);
    sendCommandStateEvent(
      {
        state: CommandResult.REJECTED,
        command_id: "other_command_id",
      },
      eventSourceMock
    );
    expect(otherPublishedCommandStates).toHaveLength(2);
  });

  it("RoonWebClient#onZoneState should always replay last known ZoneState for each zone and forward incoming events", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendZoneEvent(
      {
        ...ZONE_STATE,
        state: "loading",
      },
      eventSourceMock
    );
    sendZoneEvent(
      {
        ...OTHER_ZONE_STATE,
        state: "loading",
      },
      eventSourceMock
    );
    client.onZoneState(zoneStateListener);
    expect(publishedZoneStates).toHaveLength(2);
    sendZoneEvent(ZONE_STATE, eventSourceMock);
    sendZoneEvent(OTHER_ZONE_STATE, eventSourceMock);
    expect(publishedZoneStates).toHaveLength(4);
    expect(publishedZoneStates[2]).toEqual(ZONE_STATE);
    expect(publishedZoneStates[3]).toEqual(OTHER_ZONE_STATE);
    const otherPublishedZoneStates: ZoneState[] = [];
    client.onZoneState((zs: ZoneState) => otherPublishedZoneStates.push(zs));
    expect(otherPublishedZoneStates).toHaveLength(2);
    expect(otherPublishedZoneStates).toEqual([ZONE_STATE, OTHER_ZONE_STATE]);
  });

  it("RoonWebClient#onZoneState should gracefully ignore incoming events with malformed JSON", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendZoneEvent(ZONE_STATE, eventSourceMock);
    sendZoneEvent(OTHER_ZONE_STATE, eventSourceMock);
    client.onZoneState(zoneStateListener);
    expect(publishedZoneStates).toHaveLength(2);
    eventSourceMock?.dispatchEvent(
      new MessageEvent<string>("zone", {
        data: "{",
      })
    );
    expect(publishedZoneStates).toHaveLength(2);
    expect(publishedZoneStates[0]).toEqual(ZONE_STATE);
    expect(publishedZoneStates[1]).toEqual(OTHER_ZONE_STATE);
  });

  it("RoonWebClient#offZoneState should unregister the given ZoneStateListener without impact on the other registered listeners", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    client.onZoneState(zoneStateListener);
    const otherPublishedZoneStates: ZoneState[] = [];
    const otherListener: ZoneStateListener = (state: ZoneState) => {
      otherPublishedZoneStates.push(state);
    };
    client.onZoneState(otherListener);
    sendZoneEvent(ZONE_STATE, eventSourceMock);
    expect(publishedZoneStates).toHaveLength(1);
    expect(otherPublishedZoneStates).toHaveLength(1);
    client.offZoneState(zoneStateListener);
    sendZoneEvent(OTHER_ZONE_STATE, eventSourceMock);
    expect(publishedZoneStates).toHaveLength(1);
    expect(otherPublishedZoneStates).toHaveLength(2);
  });

  it("RoonWebClient#offZoneState should ignore silently unregistered listeners", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    const otherPublishedZoneStates: ZoneState[] = [];
    const otherListener: ZoneStateListener = (state: ZoneState) => {
      otherPublishedZoneStates.push(state);
    };
    client.onZoneState(otherListener);
    sendZoneEvent(ZONE_STATE, eventSourceMock);
    expect(otherPublishedZoneStates).toHaveLength(1);
    client.offZoneState(zoneStateListener);
    sendZoneEvent(OTHER_ZONE_STATE, eventSourceMock);
    expect(otherPublishedZoneStates).toHaveLength(2);
  });

  it("RoonWebClient#onQueueState should always replay last known QueueState for each zone and forward incoming events", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendQueueEvent(
      {
        ...QUEUE_STATE,
        tracks: [
          {
            ...QUEUE_STATE.tracks[0],
            length: "different_length",
          },
        ],
      },
      eventSourceMock
    );
    sendQueueEvent(
      {
        ...OTHER_QUEUE_STATE,
        tracks: [
          {
            ...OTHER_QUEUE_STATE.tracks[0],
            length: "other_different_length",
          },
        ],
      },
      eventSourceMock
    );
    client.onQueueState(queueStateListener);
    expect(publishedQueueStates).toHaveLength(2);
    sendQueueEvent(QUEUE_STATE, eventSourceMock);
    sendQueueEvent(OTHER_QUEUE_STATE, eventSourceMock);
    expect(publishedQueueStates).toHaveLength(4);
    expect(publishedQueueStates[2]).toEqual(QUEUE_STATE);
    expect(publishedQueueStates[3]).toEqual(OTHER_QUEUE_STATE);
    const otherPublishedQueueStates: QueueState[] = [];
    client.onQueueState((qs: QueueState) => otherPublishedQueueStates.push(qs));
    expect(otherPublishedQueueStates).toHaveLength(2);
    expect(otherPublishedQueueStates).toEqual([QUEUE_STATE, OTHER_QUEUE_STATE]);
  });

  it("RoonWebClient#onQueueState should gracefully ignore incoming events with malformed JSON", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendQueueEvent(QUEUE_STATE, eventSourceMock);
    sendQueueEvent(OTHER_QUEUE_STATE, eventSourceMock);
    client.onQueueState(queueStateListener);
    expect(publishedQueueStates).toHaveLength(2);
    eventSourceMock?.dispatchEvent(
      new MessageEvent<string>("queue", {
        data: "{",
      })
    );
    expect(publishedQueueStates).toHaveLength(2);
    expect(publishedQueueStates[0]).toEqual(QUEUE_STATE);
    expect(publishedQueueStates[1]).toEqual(OTHER_QUEUE_STATE);
  });

  it("RoonWebClient#offQueueState should unregister the given QueueStateListener without impact on the other registered listeners", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    client.onQueueState(queueStateListener);
    const otherPublishedQueueStates: QueueState[] = [];
    const otherListener: QueueStateListener = (state: QueueState) => {
      otherPublishedQueueStates.push(state);
    };
    client.onQueueState(otherListener);
    sendQueueEvent(QUEUE_STATE, eventSourceMock);
    expect(publishedQueueStates).toHaveLength(1);
    expect(otherPublishedQueueStates).toHaveLength(1);
    client.offQueueState(queueStateListener);
    sendQueueEvent(OTHER_QUEUE_STATE, eventSourceMock);
    expect(publishedQueueStates).toHaveLength(1);
    expect(otherPublishedQueueStates).toHaveLength(2);
  });

  it("RoonWebClient#offQueueState should ignore silently unregistered listeners", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    const otherPublishedQueueStates: QueueState[] = [];
    const otherListener: QueueStateListener = (state: QueueState) => {
      otherPublishedQueueStates.push(state);
    };
    client.onQueueState(otherListener);
    sendQueueEvent(QUEUE_STATE, eventSourceMock);
    expect(otherPublishedQueueStates).toHaveLength(1);
    client.offQueueState(queueStateListener);
    sendQueueEvent(OTHER_QUEUE_STATE, eventSourceMock);
    expect(otherPublishedQueueStates).toHaveLength(2);
  });

  it("RoonWebClient#onSharedConfig should forward incoming events to registered listener", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    client.onSharedConfig(sharedConfigListener);
    expect(publishedSharedConfig).toHaveLength(0);
    sendSharedConfigEvent(
      {
        customActions: [],
      },
      eventSourceMock
    );
    sendSharedConfigEvent(
      {
        customActions: [
          {
            id: "id",
            label: "label",
            icon: "icon",
            roonPath: {
              hierarchy: "browse",
              path: [],
            },
          },
        ],
      },
      eventSourceMock
    );
    expect(publishedSharedConfig).toHaveLength(2);
    expect(publishedSharedConfig[0].customActions).toHaveLength(0);
    expect(publishedSharedConfig[1].customActions).toHaveLength(1);
    const otherPublishedSharedConfig: SharedConfig[] = [];
    client.onSharedConfig((sc: SharedConfig) => otherPublishedSharedConfig.push(sc));
    expect(otherPublishedSharedConfig).toHaveLength(0);
    sendSharedConfigEvent(
      {
        customActions: [],
      },
      eventSourceMock
    );
    expect(otherPublishedSharedConfig).toHaveLength(1);
    expect(publishedSharedConfig).toHaveLength(3);
  });

  it("RoonWebClient#onSharedConfig should gracefully ignore incoming events with malformed JSON", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    client.onSharedConfig(sharedConfigListener);
    eventSourceMock?.dispatchEvent(
      new MessageEvent<string>("config", {
        data: "{",
      })
    );
    expect(publishedQueueStates).toHaveLength(0);
  });

  it("RoonWebClient#onSharedConfig should unregister the given SharedConfigListener without impact on the other registered listeners", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    client.onSharedConfig(sharedConfigListener);
    const otherPublishedSharedConfig: SharedConfig[] = [];
    const otherListener: SharedConfigListener = (sc: SharedConfig) => {
      otherPublishedSharedConfig.push(sc);
    };
    client.onSharedConfig(otherListener);
    sendSharedConfigEvent(
      {
        customActions: [],
      },
      eventSourceMock
    );
    expect(publishedSharedConfig).toHaveLength(1);
    expect(otherPublishedSharedConfig).toHaveLength(1);
    client.offSharedConfig(sharedConfigListener);
    sendSharedConfigEvent(
      {
        customActions: [],
      },
      eventSourceMock
    );
    expect(publishedSharedConfig).toHaveLength(1);
    expect(otherPublishedSharedConfig).toHaveLength(2);
  });

  it("RoonWebClient#offQueueState should ignore silently unregistered listeners", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    const otherPublishedSharedConfig: SharedConfig[] = [];
    const otherListener: SharedConfigListener = (sc: SharedConfig) => {
      otherPublishedSharedConfig.push(sc);
    };
    client.onSharedConfig(otherListener);
    sendSharedConfigEvent(
      {
        customActions: [],
      },
      eventSourceMock
    );
    expect(otherPublishedSharedConfig).toHaveLength(1);
    client.offQueueState(queueStateListener);
    sendSharedConfigEvent(
      {
        customActions: [],
      },
      eventSourceMock
    );
    expect(otherPublishedSharedConfig).toHaveLength(2);
  });

  it("RoonWebClient#stop should call POST '${client_path}/unregister', close the EventSource and clean any data", async () => {
    fetchMock
      .once(mockVersionGet)
      .once(mockRegisterPost)
      .once((req: Request) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/unregister`, API_URL).toString()) {
          return Promise.resolve({
            status: 204,
          });
        } else {
          return Promise.reject(new Error("error"));
        }
      });
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendStateEvent(SYNC_API_STATE_WITH_TWO_ZONES, eventSourceMock);
    sendZoneEvent(ZONE_STATE, eventSourceMock);
    sendZoneEvent(OTHER_ZONE_STATE, eventSourceMock);
    client.onRoonState(roonStateListener);
    client.onZoneState(zoneStateListener);
    expect(publishedRoonStates).toHaveLength(1);
    expect(publishedZoneStates).toHaveLength(2);
    client.onRoonState(roonStateListener);
    client.onZoneState(zoneStateListener);
    expect(publishedRoonStates).toHaveLength(2);
    expect(publishedZoneStates).toHaveLength(4);
    await client.stop();
    expect(fetchMock.mock.calls).toHaveLength(3);
    const sentRequest = fetchMock.mock.calls[2][0] as Request;
    expect(sentRequest.url).toEqual(new URL(`${client_path}/unregister`, API_URL).toString());
    expect(sentRequest.method).toEqual("POST");
    expect(eventSourceMock?.close).toHaveBeenCalledTimes(1);
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    await client.start();
    client.onRoonState(roonStateListener);
    client.onZoneState(zoneStateListener);
    expect(publishedRoonStates).toHaveLength(5);
    expect(publishedZoneStates).toHaveLength(4);
  });

  it("RoonWebClient#stop should return a rejected Promise on any error during call of POST '/api/client_id/unregister', without closing the EventSource or any open Observable", async () => {
    const error = new Error("network error");
    fetchMock
      .once(mockVersionGet)
      .once(mockRegisterPost)
      .once((req: Request) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/unregister`, API_URL).toString()) {
          return Promise.reject(error);
        } else {
          return Promise.resolve("ok");
        }
      });
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendStateEvent(SYNC_API_STATE_WITH_TWO_ZONES, eventSourceMock);
    sendZoneEvent(ZONE_STATE, eventSourceMock);
    sendZoneEvent(OTHER_ZONE_STATE, eventSourceMock);
    const stopPromise = client.stop();
    void expect(stopPromise).rejects.toEqual(error);
    expect(fetchMock.mock.calls).toHaveLength(3);
    const sentRequest = fetchMock.mock.calls[2][0] as Request;
    expect(sentRequest.url).toEqual(new URL(`${client_path}/unregister`, API_URL).toString());
    expect(sentRequest.method).toEqual("POST");
  });

  it("RoonWebClient#stop should return a rejected Promise is status of response of call to POST '${client_path}/unregister', without closing the EventSource or clean any data", async () => {
    const error = new Error("unable to unregister client");
    fetchMock
      .once(mockVersionGet)
      .once(mockRegisterPost)
      .once((req: Request) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/unregister`, API_URL).toString()) {
          return Promise.resolve({
            status: 200,
          });
        } else {
          return Promise.reject(new Error("error"));
        }
      });
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const eventSourceMock = eventSourceMocks.get(EVENTS_URL.toString());
    sendStateEvent(SYNC_API_STATE_WITH_TWO_ZONES, eventSourceMock);
    sendZoneEvent(ZONE_STATE, eventSourceMock);
    sendZoneEvent(OTHER_ZONE_STATE, eventSourceMock);
    client.onRoonState(roonStateListener);
    client.onZoneState(zoneStateListener);
    expect(publishedRoonStates).toHaveLength(1);
    expect(publishedZoneStates).toHaveLength(2);
    const stopPromise = client.stop();
    void expect(stopPromise).rejects.toEqual(error);
    expect(fetchMock.mock.calls).toHaveLength(3);
    const sentRequest = fetchMock.mock.calls[2][0] as Request;
    expect(sentRequest.url).toEqual(new URL(`${client_path}/unregister`, API_URL).toString());
    expect(sentRequest.method).toEqual("POST");
    expect(eventSourceMock?.close).toHaveBeenCalledTimes(0);
    sendStateEvent(SYNC_API_STATE_WITH_TWO_ZONES, eventSourceMock);
    sendZoneEvent(ZONE_STATE, eventSourceMock);
    sendZoneEvent(OTHER_ZONE_STATE, eventSourceMock);
    expect(publishedRoonStates).toHaveLength(2);
    expect(publishedZoneStates).toHaveLength(4);
  });

  it(
    "RoonWebClient#command should call POST '${client_path}/command' " +
      "with the given Command serialized as JSON in the body and return a Promise containing the returned command_id",
    async () => {
      const command_id = "command_id";
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req: Request) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/command`, API_URL).toString()) {
            return Promise.resolve({
              body: JSON.stringify({
                command_id,
              }),
              status: 202,
            });
          } else {
            return Promise.reject(new Error("error"));
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const returnedCommandId = await client.command(COMMAND);
      expect(returnedCommandId).toEqual(command_id);
      expect(fetchMock.mock.calls).toHaveLength(3);
      const sentRequest = fetchMock.mock.calls[2][0] as Request;
      expect(sentRequest.url).toEqual(new URL(`${client_path}/command`, API_URL).toString());
      expect(sentRequest.method).toEqual("POST");
      expect(sentRequest.headers.get("Accept")).toEqual("application/json");
      expect(sentRequest.headers.get("Content-Type")).toEqual("application/json");
      const sentBody = await sentRequest.text();
      expect(sentBody).toEqual(JSON.stringify(COMMAND));
    }
  );

  it(
    "RoonWebClient#command should call POST '${client_path}/command' " +
      "and then return a rejected Promise if any error occurred",
    async () => {
      const error = new Error("network error");
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req: Request) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/command`, API_URL).toString()) {
            return Promise.reject(error);
          } else {
            return Promise.resolve("ok");
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const commandPromise = client.command(COMMAND);
      void expect(commandPromise).rejects.toEqual(error);
    }
  );

  it(
    "RoonWebClient#command should call POST '${client_path}/command' " +
      "and then return a rejected Promise if the status of the response is not 202",
    async () => {
      const command_id = "command_id";
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req: Request) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/command`, API_URL).toString()) {
            return Promise.resolve({
              body: JSON.stringify({
                command_id,
              }),
              status: 200,
            });
          } else {
            return Promise.reject(new Error("error"));
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const commandPromise = client.command(COMMAND);
      void expect(commandPromise).rejects.toEqual(new Error("unable to send command"));
    }
  );

  it(
    "RoonWebClient#command should auto-refresh client state if a 403 is returned while calling POST '${client_path}/command' " +
      "and then call POST '${client_path}/command' again",
    async () => {
      const command_id = "command_id";
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req: Request) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/command`, API_URL).toString()) {
            return Promise.resolve({
              status: 403,
            });
          } else {
            return Promise.reject(new Error("error"));
          }
        })
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req: Request) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/command`, API_URL).toString()) {
            return Promise.resolve({
              body: JSON.stringify({
                command_id,
              }),
              status: 202,
            });
          } else {
            return Promise.reject(new Error("error"));
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const refreshSpy = jest.spyOn(client, "refresh");
      const returnedCommandId = await client.command(COMMAND);
      expect(returnedCommandId).toEqual(command_id);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    }
  );

  it(
    "RoonWebClient#browse should call POST '${client_path}/browse' " +
      "with the given ClientRoonApiBrowseOptions serialized as JSON in in the body and return a Promise containing the returned RoonApiBrowseResponse",
    async () => {
      const options: RoonApiBrowseOptions = {
        hierarchy: "browse",
      };
      const roonApiBrowseResponse: RoonApiBrowseResponse = {
        action: "action",
      };
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/browse`, API_URL).toString()) {
            return Promise.resolve(JSON.stringify(roonApiBrowseResponse));
          } else {
            return Promise.reject(new Error("error"));
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const response = await client.browse(options);
      expect(response).toEqual(roonApiBrowseResponse);
      expect(fetchMock.mock.calls).toHaveLength(3);
      const sentRequest = fetchMock.mock.calls[2][0] as Request;
      expect(sentRequest.url).toEqual(new URL(`${client_path}/browse`, API_URL).toString());
      expect(sentRequest.method).toEqual("POST");
      expect(sentRequest.headers.get("Accept")).toEqual("application/json");
      expect(sentRequest.headers.get("Content-Type")).toEqual("application/json");
      const sentBody = await sentRequest.text();
      expect(sentBody).toEqual(JSON.stringify(options));
    }
  );

  it(
    "RoonWebClient#browse should call POST '${client_path}/browse' " +
      "and then return a rejected Promise if any error occurred",
    async () => {
      const options: RoonApiBrowseOptions = {
        hierarchy: "browse",
      };
      const error = new Error("error");
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/browse`, API_URL).toString()) {
            return Promise.reject(error);
          } else {
            return Promise.resolve("ok");
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const responsePromise = client.browse(options);
      void expect(responsePromise).rejects.toBe(error);
    }
  );

  it(
    "RoonWebClient#browse should call POST '${client_path}/browse' " +
      "and then return a rejected Promise if the status of the response is not 200",
    async () => {
      const options: RoonApiBrowseOptions = {
        hierarchy: "browse",
      };
      const roonApiBrowseResponse: RoonApiBrowseResponse = {
        action: "action",
      };
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/browse`, API_URL).toString()) {
            return Promise.resolve({
              status: 202,
              body: JSON.stringify(roonApiBrowseResponse),
            });
          } else {
            return Promise.reject(new Error("error"));
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const responsePromise = client.browse(options);
      void expect(responsePromise).rejects.toEqual(new Error("unable to browse content"));
    }
  );

  it(
    "RoonWebClient#browse should auto-refresh client state if a 403 is returned during the call of POST '${client_path}/browse' " +
      "and then call POST '${client_path}/browse' again",
    async () => {
      const options: RoonApiBrowseOptions = {
        hierarchy: "browse",
      };
      const roonApiBrowseResponse: RoonApiBrowseResponse = {
        action: "action",
      };
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/browse`, API_URL).toString()) {
            return Promise.resolve({
              status: 403,
            });
          } else {
            return Promise.reject(new Error("error"));
          }
        })
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/browse`, API_URL).toString()) {
            return Promise.resolve(JSON.stringify(roonApiBrowseResponse));
          } else {
            return Promise.reject(new Error("error"));
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const refreshSpy = jest.spyOn(client, "refresh");
      const response = await client.browse(options);
      expect(response).toEqual(roonApiBrowseResponse);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    }
  );

  it(
    "RoonWebClient#load should call POST '${client_path}/load' " +
      "with the given ClientRoonApiBrowseLoadOptions serialized as JSON in in the body and return a Promise containing the returned RoonApiBrowseLoadResponse",
    async () => {
      const options: RoonApiBrowseLoadOptions = {
        hierarchy: "browse",
        level: 42,
      };
      const roonApiLoadResponse: RoonApiBrowseLoadResponse = {
        offset: 420,
        list: {
          title: "title",
          count: 42,
          level: 420,
        },
        items: [
          {
            title: "title",
          },
        ],
      };
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/load`, API_URL).toString()) {
            return Promise.resolve(JSON.stringify(roonApiLoadResponse));
          } else {
            return Promise.reject(new Error("error"));
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const response = await client.load(options);
      expect(response).toEqual(roonApiLoadResponse);
      expect(fetchMock.mock.calls).toHaveLength(3);
      const sentRequest = fetchMock.mock.calls[2][0] as Request;
      expect(sentRequest.url).toEqual(new URL(`${client_path}/load`, API_URL).toString());
      expect(sentRequest.method).toEqual("POST");
      expect(sentRequest.headers.get("Accept")).toEqual("application/json");
      expect(sentRequest.headers.get("Content-Type")).toEqual("application/json");
      const sentBody = await sentRequest.text();
      expect(sentBody).toEqual(JSON.stringify(options));
    }
  );

  it(
    "RoonWebClient#load should call POST '${client_path}/load' " +
      "and then return a rejected Promise if any error occurred",
    async () => {
      const options: RoonApiBrowseLoadOptions = {
        hierarchy: "browse",
      };
      const error = new Error("error");
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/load`, API_URL).toString()) {
            return Promise.reject(error);
          } else {
            return Promise.resolve("ok");
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const responsePromise = client.load(options);
      void expect(responsePromise).rejects.toBe(error);
    }
  );

  it(
    "RoonWebClient#load should call POST '${client_path}/load' " +
      "and then return a rejected Promise if the status of the response is not 200",
    async () => {
      const options: RoonApiBrowseLoadOptions = {
        hierarchy: "browse",
      };
      const roonApiLoadResponse: RoonApiBrowseLoadResponse = {
        offset: 420,
        list: {
          title: "title",
          count: 42,
          level: 420,
        },
        items: [
          {
            title: "title",
          },
        ],
      };
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/load`, API_URL).toString()) {
            return Promise.resolve({
              status: 202,
              body: JSON.stringify(roonApiLoadResponse),
            });
          } else {
            return Promise.reject(new Error("error"));
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const responsePromise = client.load(options);
      void expect(responsePromise).rejects.toEqual(new Error("unable to load content"));
    }
  );

  it("RoonWebClient#loadPath should recursively call RoonWebClient#browse and RoonWebClient#load in the given hierarchy until the searched path is found", async () => {
    const path: RoonPath = {
      hierarchy: "browse",
      path: ["Tidal", "Playlists"],
    };
    const firstBrowseResponse: RoonApiBrowseResponse = {
      action: "list",
      list: {
        level: 1,
        title: "title",
        count: 42,
      },
    };
    const firstLoadResponse: RoonApiBrowseLoadResponse = {
      list: {
        level: 1,
        title: "title",
        count: 42,
      },
      offset: 0,
      items: [
        {
          title: "title",
        },
        {
          title: "Tidal",
          item_key: "tidal_item_key",
        },
        {
          title: "other_title",
        },
      ],
    };
    const secondBrowseResponse: RoonApiBrowseResponse = {
      action: "list",
      list: {
        level: 2,
        title: "title",
        count: 42,
      },
    };
    const secondLoadResponse: RoonApiBrowseLoadResponse = {
      list: {
        level: 1,
        title: "title",
        count: 42,
      },
      offset: 0,
      items: [
        {
          title: "title",
        },
        {
          title: "other_title",
        },
        {
          title: "Playlists",
          item_key: "tidal_playlist_item_key",
        },
      ],
    };
    const thirdBrowseResponse: RoonApiBrowseResponse = {
      action: "list",
      list: {
        level: 3,
        title: "title",
        count: 42,
      },
    };
    const thirdLoadResponse: RoonApiBrowseLoadResponse = {
      list: {
        level: 1,
        title: "title",
        count: 42,
      },
      offset: 0,
      items: [
        {
          title: "playlist_title",
        },
        {
          title: "other_playlist_title",
        },
        {
          title: "yet_another_playlist_title",
        },
      ],
    };
    fetchMock
      .once(mockVersionGet)
      .once(mockRegisterPost)
      .once((req) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/browse`, API_URL).toString()) {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify(firstBrowseResponse),
          });
        } else {
          return Promise.reject(new Error("error"));
        }
      })
      .once((req) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/load`, API_URL).toString()) {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify(firstLoadResponse),
          });
        } else {
          return Promise.reject(new Error("error"));
        }
      })
      .once((req) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/browse`, API_URL).toString()) {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify(secondBrowseResponse),
          });
        } else {
          return Promise.reject(new Error("error"));
        }
      })
      .once((req) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/load`, API_URL).toString()) {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify(secondLoadResponse),
          });
        } else {
          return Promise.reject(new Error("error"));
        }
      })
      .once((req) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/browse`, API_URL).toString()) {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify(thirdBrowseResponse),
          });
        } else {
          return Promise.reject(new Error("error"));
        }
      })
      .once((req) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/load`, API_URL).toString()) {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify(thirdLoadResponse),
          });
        } else {
          return Promise.reject(new Error("error"));
        }
      });
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const browseSpy = jest.spyOn(client, "browse");
    const loadSpy = jest.spyOn(client, "load");
    const response = await client.loadPath(zone_id, path);
    expect(response).toEqual(thirdLoadResponse);
    expect(browseSpy).toHaveBeenCalledTimes(3);
    expect(loadSpy).toHaveBeenCalledTimes(3);
  });

  it("RoonWebClient#loadPath should throw an error if a path element is not found at expected level in the given hierarchy", async () => {
    const path: RoonPath = {
      hierarchy: "browse",
      path: ["Tidal", "Another path that won't be searched"],
    };
    const firstBrowseResponse: RoonApiBrowseResponse = {
      action: "list",
      list: {
        level: 1,
        title: "title",
        count: 42,
      },
    };
    const firstLoadResponse: RoonApiBrowseLoadResponse = {
      list: {
        level: 1,
        title: "title",
        count: 42,
      },
      offset: 0,
      items: [
        {
          title: "title",
        },
        {
          title: "not_Tidal",
          item_key: "tidal_item_key",
        },
        {
          title: "other_title",
        },
      ],
    };
    fetchMock
      .once(mockVersionGet)
      .once(mockRegisterPost)
      .once((req) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/browse`, API_URL).toString()) {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify(firstBrowseResponse),
          });
        } else {
          return Promise.reject(new Error("error"));
        }
      })
      .once((req) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/load`, API_URL).toString()) {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify(firstLoadResponse),
          });
        } else {
          return Promise.reject(new Error("error"));
        }
      });
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const browseSpy = jest.spyOn(client, "browse");
    const loadSpy = jest.spyOn(client, "load");
    let loadPathError: Error | undefined = undefined;
    try {
      await client.loadPath(zone_id, path);
    } catch (err: unknown) {
      if (err instanceof Error) {
        loadPathError = err;
      }
    }
    expect(loadPathError).toEqual(
      new Error("invalid path: 'browse' - 'Tidal -> Another path that won't be searched' not found")
    );
    expect(browseSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it("RoonWebClient#findItemIndex should load the List in the hierarchy described in the provided ItemIndexSearch, filter items and return the first which title starts by the searched letter", async () => {
    const generatedItems = itemsGenerator();
    const items = generatedItems.flatMap((genItems) => genItems.items);
    const itemIndexSearch: ItemIndexSearch = {
      hierarchy: "browse",
      list: {
        level: 42,
        count: items.length,
        title: "title",
      },
      letter: "C",
    };
    const loadResponse: RoonApiBrowseLoadResponse = {
      list: itemIndexSearch.list,
      items,
      offset: 0,
    };
    fetchMock
      .once(mockVersionGet)
      .once(mockRegisterPost)
      .once((req) => {
        if (req.method === "POST" && req.url === new URL(`${client_path}/load`, API_URL).toString()) {
          return Promise.resolve({
            status: 200,
            body: JSON.stringify(loadResponse),
          });
        } else {
          return Promise.reject(new Error());
        }
      });
    const client = roonWebClientFactory.build(API_URL);
    const loadSpy = jest.spyOn(client, "load");
    await client.start();

    const foundIndex = await client.findItemIndex(itemIndexSearch);

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith({
      hierarchy: itemIndexSearch.hierarchy,
      level: itemIndexSearch.list.level,
      count: itemIndexSearch.list.count,
      offset: 0,
    });
    expect(foundIndex.list).toBe(itemIndexSearch.list);
    expect(foundIndex.items).toEqual(items);
    expect(foundIndex.offset).toEqual(0);
    expect(foundIndex.itemIndex).toEqual(generatedItems[0].items.length + generatedItems[1].items.length);
  });

  it("RoonWebClient#findItemIndex should use the items provided in ItemIndexSearch if defined and search in these items", async () => {
    const generatedItems = itemsGenerator(7, [2, 0, 0, 4, 0, 420, 123]);
    const items = generatedItems.flatMap((genItems) => genItems.items);
    const itemIndexSearch: ItemIndexSearch = {
      hierarchy: "browse",
      list: {
        level: 42,
        count: items.length,
        title: "title",
      },
      letter: "D",
      items,
    };
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    const loadSpy = jest.spyOn(client, "load");
    await client.start();

    const foundIndex = await client.findItemIndex(itemIndexSearch);

    expect(loadSpy).toHaveBeenCalledTimes(0);
    expect(foundIndex.list).toBe(itemIndexSearch.list);
    expect(foundIndex.items).toEqual(items);
    expect(foundIndex.offset).toEqual(0);
    expect(foundIndex.itemIndex).toEqual(
      generatedItems[0].items.length + generatedItems[1].items.length + generatedItems[2].items.length
    );
  });

  it("RoonWebClient#findItemIndex should return the index of the last item which title is before the searched letter if none is starting by the searched letter", async () => {
    const generatedItems = itemsGenerator(4, [120, 0, 0, 1]);
    const items = generatedItems.flatMap((genItems) => genItems.items);
    const itemIndexSearch: ItemIndexSearch = {
      hierarchy: "browse",
      list: {
        level: 42,
        count: items.length,
        title: "title",
      },
      letter: "C",
      items,
    };
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    const loadSpy = jest.spyOn(client, "load");
    await client.start();

    const foundIndex = await client.findItemIndex(itemIndexSearch);

    expect(loadSpy).toHaveBeenCalledTimes(0);
    expect(foundIndex.list).toBe(itemIndexSearch.list);
    expect(foundIndex.items).toEqual(items);
    expect(foundIndex.offset).toEqual(0);
    expect(foundIndex.itemIndex).toEqual(119);
  });

  it(
    "RoonWebClient#load should auto-refresh client state if a 403 is returned during the call of POST '${client_path}/load' " +
      "and then call POST '${client_path}/load' again",
    async () => {
      const options: RoonApiBrowseLoadOptions = {
        hierarchy: "browse",
        level: 42,
      };
      const roonApiLoadResponse: RoonApiBrowseLoadResponse = {
        offset: 420,
        list: {
          title: "title",
          count: 42,
          level: 420,
        },
        items: [
          {
            title: "title",
          },
        ],
      };
      fetchMock
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/load`, API_URL).toString()) {
            return Promise.resolve({
              status: 403,
            });
          } else {
            return Promise.reject(new Error("error"));
          }
        })
        .once(mockVersionGet)
        .once(mockRegisterPost)
        .once((req) => {
          if (req.method === "POST" && req.url === new URL(`${client_path}/load`, API_URL).toString()) {
            return Promise.resolve(JSON.stringify(roonApiLoadResponse));
          } else {
            return Promise.reject(new Error("error"));
          }
        });
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      const refreshSpy = jest.spyOn(client, "refresh");
      const response = await client.load(options);
      expect(response).toEqual(roonApiLoadResponse);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    }
  );

  it("RoonWebClient#restart should cleanup and call RoonWebClient#start", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const startSpy = jest.spyOn(client, "start");
    const eventSource = eventSourceMocks.get(EVENTS_URL.toString());
    expect(eventSource).not.toBeUndefined();
    const eventSourceCloseSpy = jest.spyOn(
      eventSource ?? {
        close: () => {},
      },
      "close"
    );
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    await client.restart();
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(eventSourceCloseSpy).toHaveBeenCalledTimes(1);
  });

  it("RoonWebClient#restart should cancel ongoing restarts", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    fetchMock
      .once(() => {
        return new Promise(() => {});
      })
      .once(mockVersionGet)
      .once(mockRegisterPost);
    const firstRestart = client.restart();
    const secondRestart = client.restart();
    void expect(firstRestart).rejects.toEqual(new DOMException("The operation was aborted", "ABORT_ERROR"));
    void expect(secondRestart).resolves;
  });

  it(
    "RoonWebClient#restart should return a fulfilled Promise after publishing an 'outdated' ClientState " +
      "if the api version has changed since the first call to #start",
    async () => {
      fetchMock.once(mockVersionGet).once(mockRegisterPost);
      const client = roonWebClientFactory.build(API_URL);
      await client.start();
      fetchMock
        .once((req) => {
          if (req.method === "GET" && req.url === new URL("/api/version", API_URL).toString()) {
            return Promise.resolve({
              headers: {
                "x-roon-web-stack-version": "new_version",
              },
              status: 204,
            });
          } else {
            return Promise.reject(new Error("error"));
          }
        })
        .once(mockRegisterPost);
      client.onClientState(clientStateListener);
      await client.restart();
      expect(publishedClientStates).toEqual([
        {
          status: "outdated",
        },
        {
          status: "started",
          roonClientId: "client_id",
        },
      ]);
    }
  );

  it("RoonWebClient#version should return the version returned by the API in 'x-roon-web-stack-version' header of the response of GET '/api/version'", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    expect(client.version()).toEqual(VERSION);
  });

  it("RoonWebClient#refresh should not call #restart if no error has happened on the underlying SSE request", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const restartSpy = jest.spyOn(client, "restart");
    await client.refresh();
    expect(restartSpy).toHaveBeenCalledTimes(0);
  });

  it("RoonWebClient#refresh should call #restart if an error has happened on the underlying SSE request", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const restartSpy = jest.spyOn(client, "restart");
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const eventSource = eventSourceMocks.get(EVENTS_URL.toString());
    if (eventSource && eventSource.onerror) {
      eventSource.onerror();
    }
    await client.refresh();
    expect(restartSpy).toHaveBeenCalledTimes(1);
    await client.refresh();
    expect(restartSpy).toHaveBeenCalledTimes(1);
  });

  it("RoonWebClient#refresh should let the client marked as to be refreshed if any error happen during #restart", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const restartSpy = jest.spyOn(client, "restart");
    fetchMock.once(mockVersionGet);
    const eventSource = eventSourceMocks.get(EVENTS_URL.toString());
    if (eventSource && eventSource.onerror) {
      eventSource.onerror();
    }
    let error: Error | undefined = undefined;
    try {
      await client.refresh();
    } catch (err) {
      if (err instanceof Error) {
        error = err;
      }
    }
    expect(error).not.toBeUndefined();
    expect(restartSpy).toHaveBeenCalledTimes(1);
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    await client.refresh();
    expect(restartSpy).toHaveBeenCalledTimes(2);
    await client.refresh();
    expect(restartSpy).toHaveBeenCalledTimes(2);
  });

  it("RoonWebClient should mark client to be refreshed if a new Ping is not received after expected time", async () => {
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const client = roonWebClientFactory.build(API_URL);
    await client.start();
    const refreshSpy = jest.spyOn(client, "refresh");
    const restartSpy = jest.spyOn(client, "restart");
    fetchMock.once(mockVersionGet).once(mockRegisterPost);
    const eventSource = eventSourceMocks.get(EVENTS_URL.toString());
    const ping: Ping = {
      next: 1,
    };
    sendPingEvent(ping, eventSource);
    jest.advanceTimersByTime(1.5 * 1000 - 1);
    expect(refreshSpy).toHaveBeenCalledTimes(0);
    await client.refresh();
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(restartSpy).toHaveBeenCalledTimes(0);
    sendPingEvent(ping, eventSource);
    jest.advanceTimersByTime(1.5 * 1000 - 1);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    await client.refresh();
    expect(refreshSpy).toHaveBeenCalledTimes(2);
    expect(restartSpy).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(1);
    expect(refreshSpy).toHaveBeenCalledTimes(2);
    await client.refresh();
    expect(refreshSpy).toHaveBeenCalledTimes(3);
    expect(restartSpy).toHaveBeenCalledTimes(1);
  });
});

const client_path = "/api/client_id";
const other_client_id = "other_client_id";
const other_client_path = "/api/other_client_id";
const zone_id = "zone_id";
const EVENTS_URL = new URL(`${client_path}/events`, API_URL);
const COMMAND: Command = {
  type: CommandType.PLAY_PAUSE,
  data: {
    zone_id,
  },
};

const sendStateEvent = (apiState: ApiState, eventSourceMock?: EventSourceMock): void => {
  if (eventSourceMock) {
    eventSourceMock.dispatchEvent(
      new MessageEvent<string>("state", {
        data: JSON.stringify(apiState),
      })
    );
  }
};

const sendCommandStateEvent = (commandNotification: CommandState, eventSourceMock?: EventSourceMock): void => {
  if (eventSourceMock) {
    eventSourceMock.dispatchEvent(
      new MessageEvent<string>("command_state", {
        data: JSON.stringify(commandNotification),
      })
    );
  }
};

const sendZoneEvent = (zoneState: ZoneState, eventSourceMock?: EventSourceMock): void => {
  if (eventSourceMock) {
    eventSourceMock.dispatchEvent(
      new MessageEvent<string>("zone", {
        data: JSON.stringify(zoneState),
      })
    );
  }
};

const sendQueueEvent = (queueState: QueueState, eventSourceMock?: EventSourceMock): void => {
  if (eventSourceMock) {
    eventSourceMock.dispatchEvent(
      new MessageEvent<string>("queue", {
        data: JSON.stringify(queueState),
      })
    );
  }
};

const sendPingEvent = (ping: Ping, eventSourceMock?: EventSourceMock): void => {
  if (eventSourceMock) {
    eventSourceMock.dispatchEvent(
      new MessageEvent<string>("ping", {
        data: JSON.stringify(ping),
      })
    );
  }
};

const sendSharedConfigEvent = (sharedConfig: SharedConfig, eventSourceMock?: EventSourceMock): void => {
  if (eventSourceMock) {
    eventSourceMock.dispatchEvent(
      new MessageEvent<string>("config", {
        data: JSON.stringify(sharedConfig),
      })
    );
  }
};

const VERSION = "version";

const SYNC_API_STATE_WITH_TWO_ZONES: ApiState = {
  state: RoonState.SYNC,
  zones: [
    {
      display_name: "display_name",
      zone_id,
    },
    {
      display_name: "other_display_name",
      zone_id: "other_zone_id",
    },
  ],
  outputs: [
    {
      display_name: "output_display_name",
      output_id: "output_id",
      zone_id,
    },
    {
      display_name: "other_output_display_name",
      output_id: "other_output_id",
      zone_id: "other_zone_id",
    },
  ],
};

const ZONE_STATE: ZoneState = {
  zone_id,
  display_name: "display_name",
  state: "paused",
  outputs: [],
  is_next_allowed: true,
  is_play_allowed: true,
  is_previous_allowed: true,
  is_seek_allowed: true,
  is_pause_allowed: true,
  seek_position: 42,
  queue_items_remaining: 420,
  queue_time_remaining: 4242,
  settings: {
    loop: "disabled",
    shuffle: false,
    auto_radio: true,
  },
  nice_playing: {
    state: "paused",
    nb_items_in_queue: 420,
    total_queue_remaining_time: "42",
    track: {
      title: "track title",
      length: "4242",
      image_key: "track_image_key",
      artist: "track artist",
      seek_position: "424242",
      seek_percentage: 42,
      disk: {
        title: "disk title",
        artist: "disk artist",
        image_key: "disk_image_key",
      },
    },
  },
};

const OTHER_ZONE_STATE: ZoneState = {
  zone_id: "other_zone_id",
  display_name: "other_display_name",
  state: "paused",
  outputs: [],
  is_next_allowed: true,
  is_play_allowed: true,
  is_previous_allowed: true,
  is_seek_allowed: true,
  is_pause_allowed: true,
  seek_position: 420,
  queue_items_remaining: 42,
  queue_time_remaining: 424242,
  settings: {
    loop: "disabled",
    shuffle: false,
    auto_radio: true,
  },
  nice_playing: {
    state: "paused",
    nb_items_in_queue: 42,
    total_queue_remaining_time: "420",
    track: {
      title: "other track title",
      length: "424242",
      image_key: "other_track_image_key",
      artist: "other track artist",
      seek_position: "4242",
      seek_percentage: 420,
      disk: {
        title: "other disk title",
        artist: "other disk artist",
        image_key: "other_disk_image_key",
      },
    },
  },
};

const QUEUE_STATE: QueueState = {
  zone_id,
  tracks: [
    {
      title: "track title",
      length: "length",
      artist: "track artist",
      disk: {
        title: "disk title",
        artist: "disk artist",
        image_key: "disk_image_key",
      },
      image_key: "image_key",
      queue_item_id: 42,
    },
  ],
};

const OTHER_QUEUE_STATE: QueueState = {
  zone_id: "other_zone_id",
  tracks: [
    {
      title: "other_track title",
      length: "other_length",
      artist: "other_track artist",
      disk: {
        title: "other_disk title",
        artist: "other_disk artist",
        image_key: "other_disk_image_key",
      },
      image_key: "other_image_key",
      queue_item_id: 420,
    },
  ],
};

const mockVersionGet: MockResponseInitFunction = (req: Request) => {
  if (req.method === "GET" && req.url === new URL("/api/version", API_URL).toString()) {
    return Promise.resolve({
      headers: {
        "x-roon-web-stack-version": VERSION,
      },
      status: 204,
    });
  } else {
    return Promise.reject(new Error("error"));
  }
};

const mockRegisterPost: MockResponseInitFunction = (req: Request) => {
  if (req.method === "POST" && req.url.startsWith(new URL("/api/register", API_URL).toString())) {
    const Location = req.url.indexOf(other_client_id) > -1 ? other_client_path : client_path;
    return Promise.resolve({
      headers: {
        Location,
      },
      status: 201,
    });
  } else {
    return Promise.reject(new Error("error"));
  }
};

interface GeneratedItems {
  letter: string;
  items: Item[];
}

const itemsGenerator: (nbLetters?: number, itemsByLetter?: number[] | number) => GeneratedItems[] = (
  nbLetters,
  itemsByLetter
) => {
  nbLetters = nbLetters ?? 26;
  if (itemsByLetter !== undefined && typeof itemsByLetter === "number") {
    const nbItems = itemsByLetter;
    itemsByLetter = [];
    for (let i = 0; i < nbLetters; i++) {
      itemsByLetter.push(nbItems);
    }
  } else if (itemsByLetter === undefined) {
    itemsByLetter = [];
    for (let i = 0; i < nbLetters; i++) {
      itemsByLetter.push(Math.max(1, Math.floor(Math.random() * 100) % 4));
    }
  }
  const generatedItems: GeneratedItems[] = [];
  for (let i = 0; i < nbLetters; i++) {
    const letter = String.fromCharCode(65 + i);
    const nbItems = itemsByLetter[i];
    generatedItems.push(itemGenerator(letter, nbItems));
  }
  return generatedItems;
};

const itemGenerator: (letter: string, nbItems: number) => GeneratedItems = (letter, nbItems) => {
  const items: Item[] = [];
  for (let i = 0; i < nbItems; i++) {
    const withThe = Math.floor(Math.random() * 100) % 2 === 1;
    const prefix = withThe ? "The " : "";
    const title = `${prefix}${letter}${String.fromCharCode(97 + (i % 27))}`;
    items.push({
      title,
    });
  }
  return {
    items,
    letter,
  };
};
