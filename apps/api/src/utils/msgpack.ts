import { encode as msgpackEncode, decode as msgpackDecode, ExtensionCodec } from '@msgpack/msgpack';

const SET_EXT_TYPE = 0 as const;
const MAP_EXT_TYPE = 1 as const;

const extensionCodec = new ExtensionCodec();

extensionCodec.register({
  type: SET_EXT_TYPE,
  encode: (object: unknown): Uint8Array | null => {
    if (object instanceof Set) {
      return msgpackEncode([...object], { extensionCodec });
    } else {
      return null;
    }
  },
  decode: (data: Uint8Array) => {
    const array = msgpackDecode(data, { extensionCodec }) as Array<unknown>;
    return new Set(array);
  },
});
extensionCodec.register({
  type: MAP_EXT_TYPE,
  encode: (object: unknown) => {
    if (object instanceof Map) {
      return msgpackEncode([...object], { extensionCodec });
    } else {
      return null;
    }
  },
  decode: (data: Uint8Array) => {
    const array = msgpackDecode(data, { extensionCodec }) as Array<[unknown, unknown]>;
    return new Map(array);
  },
});

export const encode = (value: Parameters<typeof msgpackEncode>[0]) => msgpackEncode(value, { extensionCodec });
export const decode = (value: Parameters<typeof msgpackDecode>[0]) => msgpackDecode(value, { extensionCodec });
