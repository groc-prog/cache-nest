import { decode, encode, ExtensionCodec } from '@msgpack/msgpack';

const MAP_EXT_TYPE = 1 as const;

export const extensionCodec = new ExtensionCodec();

extensionCodec.register({
  type: MAP_EXT_TYPE,
  encode: (object: unknown) => {
    if (object instanceof Map) {
      return encode([...object], { extensionCodec });
    } else {
      return null;
    }
  },
  decode: (data: Uint8Array) => {
    const array = decode(data, { extensionCodec }) as Array<[unknown, unknown]>;
    return new Map(array);
  },
});
