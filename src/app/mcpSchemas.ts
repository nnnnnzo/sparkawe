type Schema = Record<string, unknown>;

const string = { type: "string" };
const boolean = { type: "boolean" };
const integer = { type: "integer" };
const object = { type: "object" };
const array = (items: Schema) => ({ type: "array", items });
const shape = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required });

const availability = {
  name: string,
  mutates: boolean,
  available: boolean,
  requires: array(string),
};
const action = {
  ...availability,
  title: string,
  description: string,
  input: object,
};

export const BRIEF_TILE_LIMIT = 32;

export const readOutputs = {
  spark_brief: shape({
    text: string,
    tab: string,
    lastSeq: integer,
    tileRefs: {
      ...array(shape({ ref: string, type: string })),
      maxItems: BRIEF_TILE_LIMIT,
    },
    tileRefsTruncated: boolean,
  }),
  spark_tabs: shape({
    tabs: array(
      shape({
        id: string,
        name: string,
        mode: { enum: ["side", "tiling", "stack"] },
        active: boolean,
        tiles: integer,
      }),
    ),
  }),
  spark_tiles: shape({
    tiles: array(
      shape(
        {
          type: string,
          title: string,
          extension: string,
          tier: string,
          guide: string,
          actions: array(shape(action, Object.keys(availability))),
        },
        ["type", "title", "extension", "tier", "actions"],
      ),
    ),
  }),
  spark_tile_read: shape(
    {
      ref: string,
      type: string,
      title: string,
      summary: string,
      guide: string,
      data: object,
      surface: object,
      actions: array(shape(action, [...Object.keys(availability), "title"])),
    },
    ["ref", "type", "title", "summary", "data", "surface", "actions"],
  ),
  spark_events_since: shape({
    events: array(
      shape(
        {
          seq: integer,
          at: { type: "number" },
          source: { enum: ["human", "agent", "system"] },
          kind: string,
          tabId: string,
          tileId: string,
          data: {},
        },
        ["seq", "at", "source", "kind"],
      ),
    ),
  }),
} satisfies Record<string, Schema>;
