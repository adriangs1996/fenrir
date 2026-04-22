import * as Schema from "effect/Schema";

export const SystemFontSchema = Schema.Struct({
  family: Schema.String,
  category: Schema.Literals(["monospace", "sans-serif", "serif", "other"]),
});

export type SystemFont = typeof SystemFontSchema.Type;

export const SystemFontListSchema = Schema.Array(SystemFontSchema);
export type SystemFontList = typeof SystemFontListSchema.Type;
