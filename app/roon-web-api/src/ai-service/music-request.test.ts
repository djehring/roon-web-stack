import { interpretMusicRequest, parseMusicRequest } from "./music-request";

describe("music request interpretation", () => {
  const rooms = ["Kitchen", "Office"];

  it("accepts a listed room and a known kind", () => {
    expect(parseMusicRequest('{"kind":"radio","music":" Radio 3 ","room":"Kitchen"}', rooms)).toEqual({
      kind: "radio",
      music: "Radio 3",
      room: "Kitchen",
    });
  });

  it("drops a room that is not listed", () => {
    expect(parseMusicRequest('{"kind":"artist","music":"Miles Davis","room":"Snug"}', rooms).room).toBe("");
  });

  it("rejects an unknown kind or missing music", () => {
    expect(() => parseMusicRequest('{"kind":"song","music":"Help","room":""}', rooms)).toThrow();
    expect(() => parseMusicRequest('{"kind":"radio","music":" ","room":""}', rooms)).toThrow();
  });

  it("constrains the room to the listed rooms", async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"kind":"radio","music":"Radio 3","room":"Office"}' } }],
    });
    const openai = { chat: { completions: { create } } } as never;

    const request = await interpretMusicRequest("Play Radio 3 in the office", rooms, openai);

    expect(request).toEqual({ kind: "radio", music: "Radio 3", room: "Office" });
    const [[body]] = create.mock.calls as [
      [
        {
          messages: { content: string }[];
          response_format: { json_schema: { schema: { properties: { room: { enum: string[] } } } } };
        },
      ],
    ];
    expect(body.response_format.json_schema.schema.properties.room.enum).toEqual(["Kitchen", "Office", ""]);
    expect(body.messages[0].content).toContain("Kitchen, Office");
    expect(body.messages[1].content).toBe("Play Radio 3 in the office");
  });
});
