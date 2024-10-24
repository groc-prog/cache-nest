import { Decoder, Encoder, ExtensionCodec } from '@msgpack/msgpack';

const SET_EXT_TYPE = 0 as const;
const MAP_EXT_TYPE = 1 as const;

const extensionCodec = new ExtensionCodec();
const encoder = new Encoder({
  extensionCodec,
});
const decoder = new Decoder({
  extensionCodec,
});

extensionCodec.register({
  type: SET_EXT_TYPE,
  encode: (object: unknown): Uint8Array | null => {
    if (object instanceof Set) {
      return encoder.encode([...object]);
    } else {
      return null;
    }
  },
  decode: (data: Uint8Array) => {
    const array = decoder.decode(data) as Array<unknown>;
    return new Set(array);
  },
});
extensionCodec.register({
  type: MAP_EXT_TYPE,
  encode: (object: unknown) => {
    if (object instanceof Map) {
      return encoder.encode([...object]);
    } else {
      return null;
    }
  },
  decode: (data: Uint8Array) => {
    const array = decoder.decode(data) as Array<[unknown, unknown]>;
    return new Map(array);
  },
});

export const encode = encoder.encode;
export const decode = decoder.decode;
