import { describe, expect, it } from "vitest";
import { checkJson, formatJson } from "./json";

describe("json checker", () => {
  it("formats valid JSON and can sort or minify", () => {
    expect(formatJson('{"b":1,"a":[1,2]}')).toEqual({ ok: true, text: '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}' });
    expect(formatJson('{"b":1,"a":2}', { sort: true, minify: true })).toEqual({ ok: true, text: '{"a":2,"b":1}' });
  });
  it("points at the line and column of a trailing comma", () => {
    const r = checkJson('{\n  "a": 1,\n}');
    expect(r).toMatchObject({ ok: false, line: 3, column: 1 });
    if (!r.ok) expect(r.fix).toMatch(/Delete the last comma/);
  });
  it("explains single quotes, unquoted keys, comments and HTML", () => {
    expect(checkJson("{'a': 1}")).toMatchObject({ ok: false, message: expect.stringMatching(/double quotes/) });
    expect(checkJson("{a: 1}")).toMatchObject({ ok: false, message: expect.stringMatching(/no quotes/) });
    expect(checkJson('{"a": 1 // x\n}')).toMatchObject({ ok: false });
    expect(checkJson("<!doctype html><p>no</p>")).toMatchObject({ ok: false, message: expect.stringMatching(/HTML/) });
  });
  it("reports unclosed and extra text", () => {
    expect(checkJson('{"a": [1, 2')).toMatchObject({ ok: false, message: expect.stringMatching(/\]/) });
    expect(checkJson('{"a": 1} x')).toMatchObject({ ok: false, message: expect.stringMatching(/Extra text/) });
    expect(checkJson('"open')).toMatchObject({ ok: false, message: expect.stringMatching(/never closed/) });
  });
  it("matches JSON.parse on valid input", () => {
    const text = '{"a":[1,2.5e3,-0.5,true,null,"x\\n\\u00e9"],"b":{}}';
    expect(checkJson(text)).toEqual({ ok: true, value: JSON.parse(text) });
  });
});

import { maskSecrets, tidyText } from "./json";
describe("tidyText", () => {
  it("pretty-prints JSON and tidies code", () => {
    expect(tidyText('{"a":1}')).toEqual({ kind: "json", text: '{\n  "a": 1\n}\n' });
    expect(tidyText("a  \r\n\r\n\r\n\r\n\tb\t\n")).toEqual({ kind: "code", text: "a\n\n  b\n" });
  });
  it("masks secrets", () => {
    expect(maskSecrets("GET https://x/?key=abcd1234&n=1", ["abcd1234", "ab"])).toBe("GET https://x/?key=•••&n=1");
  });
});
