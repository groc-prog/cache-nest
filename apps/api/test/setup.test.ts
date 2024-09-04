import { NodeSDK } from '@opentelemetry/sdk-node';
import { readdir, readFile, readJSON } from 'fs-extra';
import { merge } from 'lodash-es';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenTelemetryExporter } from '../src/types/configuration.js';

vi.mock('@opentelemetry/sdk-node', async (importOriginal) => {
  const original = await importOriginal<typeof import('@opentelemetry/sdk-node')>();

  return {
    ...original,
    NodeSDK: vi.fn().mockImplementation(() => ({
      start: vi.fn(),
    })),
  };
});

vi.mock('fs-extra', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs-extra')>();

  return {
    ...original,
    readdir: vi.fn(),
    readFile: vi.fn(),
    readJSON: vi.fn(),
  };
});

describe('.getApiConfiguration()', async () => {
  const processSpy = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
  const { API_CONFIG_DEFAULTS, getApiConfiguration } = await import('../src/setup.js');

  beforeEach(() => {
    processSpy.mockClear();
  });

  it('should return the default configuration', async () => {
    const nodeSdkMock = vi.mocked(NodeSDK);
    const configuration = await getApiConfiguration();

    expect(nodeSdkMock).toHaveBeenCalledTimes(0);
    expect(configuration).toEqual(API_CONFIG_DEFAULTS);
  });

  it('should use the configuration defined in a `cache-nest-config.yml` or `cache-nest-config.yaml` file', async () => {
    const readdirMock = vi.mocked(readdir);
    const readFileMock = vi.mocked(readFile);
    // @ts-ignore
    readdirMock.mockResolvedValue(['cache-nest-config.yml']);
    readFileMock.mockResolvedValue(
      // @ts-ignore
      'server:\n  port: 4000\ndrivers:\n  fileSystem:\n    maxSize: 2000\ntracing:\n  exporter: http',
    );

    const configuration = await getApiConfiguration();
    expect(configuration).toEqual(
      merge({}, API_CONFIG_DEFAULTS, {
        server: {
          port: 4000,
        },
        drivers: {
          fileSystem: { maxSize: 2000 },
        },
        tracing: { exporter: OpenTelemetryExporter.HTTP },
      }),
    );
  });

  it('should use the configuration defined in a `cache-nest-config.json` file', async () => {
    const readdirMock = vi.mocked(readdir);
    const readJSONMock = vi.mocked(readJSON);
    // @ts-ignore
    readdirMock.mockResolvedValue(['cache-nest-config.json']);
    readJSONMock.mockResolvedValue({
      server: { port: 4000 },
      drivers: { fileSystem: { maxSize: 2000 } },
      tracing: { exporter: OpenTelemetryExporter.HTTP },
    });

    const configuration = await getApiConfiguration();
    expect(configuration).toEqual(
      merge({}, API_CONFIG_DEFAULTS, {
        server: {
          port: 4000,
        },
        drivers: {
          fileSystem: { maxSize: 2000 },
        },
        tracing: { exporter: OpenTelemetryExporter.HTTP },
      }),
    );
  });

  it('should use the default configuration', async () => {
    const readdirMock = vi.mocked(readdir);
    // @ts-ignore
    readdirMock.mockResolvedValue(['cache-nest-config.dat']);

    const configuration = await getApiConfiguration();
    expect(configuration).toEqual(API_CONFIG_DEFAULTS);
  });

  it('should exit the process with a `0` code if the configuration is invalid', async () => {
    const readdirMock = vi.mocked(readdir);
    const readJSONMock = vi.mocked(readJSON);
    // @ts-ignore
    readdirMock.mockResolvedValue(['cache-nest-config.json']);
    readJSONMock.mockResolvedValue({
      drivers: { memory: { maxSize: -12 } },
    });

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should not allow `maxSize` bigger that max memory/storage', async () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(10);

    const readdirMock = vi.mocked(readdir);
    const readJSONMock = vi.mocked(readJSON);
    // @ts-ignore
    readdirMock.mockResolvedValue(['cache-nest-config.json']);
    readJSONMock.mockResolvedValue({
      drivers: { memory: { maxSize: 20 } },
    });

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should not allow `maxSize` which is neither a percentage nor a number', async () => {
    const readdirMock = vi.mocked(readdir);
    const readJSONMock = vi.mocked(readJSON);
    // @ts-ignore
    readdirMock.mockResolvedValue(['cache-nest-config.json']);
    readJSONMock.mockResolvedValue({
      drivers: { memory: { maxSize: 'invalid-value' } },
    });

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should not allow `maxSize` with a percentage smaller than or equal to 0', async () => {
    const readdirMock = vi.mocked(readdir);
    const readJSONMock = vi.mocked(readJSON);
    // @ts-ignore
    readdirMock.mockResolvedValue(['cache-nest-config.json']);
    readJSONMock.mockResolvedValue({
      drivers: { memory: { maxSize: '0%' } },
    });

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should not allow `maxSize` with a percentage greater than or equal to 100', async () => {
    const readdirMock = vi.mocked(readdir);
    const readJSONMock = vi.mocked(readJSON);
    // @ts-ignore
    readdirMock.mockResolvedValue(['cache-nest-config.json']);
    readJSONMock.mockResolvedValue({
      drivers: { memory: { maxSize: '100%' } },
    });

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should use different config file paths in development and production', async () => {
    const pathSpy = vi.spyOn(path, 'resolve');
    process.env.NODE_ENV = 'development';

    const readdirMock = vi.mocked(readdir);
    const readJSONMock = vi.mocked(readJSON);
    // @ts-ignore
    readdirMock.mockResolvedValue(['cache-nest-config.json']);
    readJSONMock.mockResolvedValue({});

    vi.resetModules();
    let module = await import('../src/setup.js');

    await module.getApiConfiguration();
    expect(pathSpy).toHaveBeenCalledWith('.');

    processSpy.mockClear();
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    module = await import('../src/setup.js');

    await module.getApiConfiguration();
    expect(pathSpy).toHaveBeenCalledWith('/etc');
  });
});
