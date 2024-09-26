import { OTLPMetricExporter as OTLPMetricExporterGrpc } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPMetricExporter as OTLPMetricExporterHttp } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPMetricExporter as OTLPMetricExporterProto } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter as OTLPTraceExporterGrpc } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as OTLPTraceExporterHttp } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as OTLPTraceExporterProto } from '@opentelemetry/exporter-trace-otlp-proto';
import { ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';
import { AlwaysOnSampler, BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { beforeEach, describe, expect, mock, it, jest, spyOn, type Mock } from 'bun:test';
import { merge } from 'lodash-es';
import os from 'os';

import { API_CONFIG_DEFAULTS, getApiConfiguration } from '@/setup';
import { OpenTelemetryExporter, type ApiConfiguration } from '@/types/configuration';

mock.module('fs-extra', () => ({
  default: {
    readdir: jest.fn(),
    readFile: jest.fn(),
    readJSON: jest.fn(),
  },
}));

mock.module('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
  })),
}));

mock.module('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: jest.fn(),
}));

describe('.getApiConfiguration()', () => {
  let sdkNodeMock: typeof import('@opentelemetry/sdk-node');
  let sdkMetricsMock: typeof import('@opentelemetry/sdk-metrics');
  let fsExtraMock: typeof import('fs-extra');
  let processSpy: Mock<typeof process.exit>;

  beforeEach(async () => {
    sdkNodeMock = await import('@opentelemetry/sdk-node');
    sdkMetricsMock = await import('@opentelemetry/sdk-metrics');
    fsExtraMock = await import('fs-extra');
    processSpy = spyOn(process, 'exit').mockImplementation(() => undefined as never);

    jest.clearAllMocks();
  });

  it('should return the default configuration', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue([]);

    const configuration = await getApiConfiguration();
    expect(sdkNodeMock.NodeSDK).not.toHaveBeenCalled();
    expect(configuration).toEqual(API_CONFIG_DEFAULTS as ApiConfiguration);
  });

  it('should use the configuration defined in a `cache-nest-config.yml` or `cache-nest-config.yaml` file', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.yml']);
    // @ts-ignore
    fsExtraMock.default.readFile.mockResolvedValue(
      'server:\n  port: 4000\ndrivers:\n  fileSystem:\n    maxSize: 2000\ntracing:\n  exporter: http',
    );

    const configuration = await getApiConfiguration();
    expect(configuration).toEqual(
      merge({}, API_CONFIG_DEFAULTS as ApiConfiguration, {
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
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      server: { port: 4000 },
      drivers: { fileSystem: { maxSize: 2000 } },
      tracing: { exporter: OpenTelemetryExporter.HTTP },
    });

    const configuration = await getApiConfiguration();
    expect(configuration).toEqual(
      merge({}, API_CONFIG_DEFAULTS as ApiConfiguration, {
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

  it('should exit the process with a `0` code if the configuration is invalid', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      drivers: { memory: { maxSize: -12 } },
    });

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should exit the process with a `0` code if an error occurs while reading a configuration file', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockRejectedValue(Error('Some error'));

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should do nothing if a non-supported configuration file is found', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.dat']);

    const configuration = await getApiConfiguration();
    expect(sdkNodeMock.NodeSDK).not.toHaveBeenCalled();
    expect(configuration).toEqual(API_CONFIG_DEFAULTS as ApiConfiguration);
    // @ts-ignore
    expect(fsExtraMock.default.readFile).not.toHaveBeenCalled();
  });

  it('should not allow `maxSize` bigger that max memory/storage', async () => {
    spyOn(os, 'totalmem').mockReturnValue(10);

    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      drivers: { memory: { maxSize: 20 } },
    });

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should not allow `maxSize` which is neither a percentage nor a number', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      drivers: { memory: { maxSize: 'invalid-value' } },
    });

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should not allow `maxSize` with a percentage smaller than or equal to 0', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      drivers: { memory: { maxSize: '0%' } },
    });

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should not allow `maxSize` with a percentage greater than or equal to 100', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      drivers: { memory: { maxSize: '100%' } },
    });

    await getApiConfiguration();
    expect(processSpy).toHaveBeenCalledWith(0);
  });

  it('should start the OpenTelemetry SDK with the console exporters', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      tracing: {
        enabled: true,
      },
      metrics: {
        enabled: true,
        interval: 20000,
      },
    });

    await getApiConfiguration();

    // @ts-ignore
    const nodeSdkArgs = sdkNodeMock.NodeSDK.mock.calls[0]![0];
    // @ts-ignore
    const periodicExportingMetricReaderArgs = sdkMetricsMock.PeriodicExportingMetricReader.mock.calls[0]![0];
    expect(sdkNodeMock.NodeSDK).toHaveBeenCalledTimes(1);
    expect(nodeSdkArgs?.traceExporter).toBeInstanceOf(ConsoleSpanExporter);
    expect(nodeSdkArgs?.sampler).toBeInstanceOf(AlwaysOnSampler);
    expect(nodeSdkArgs?.spanProcessors).toHaveLength(1);
    expect(nodeSdkArgs!.spanProcessors![0]).toBeInstanceOf(BatchSpanProcessor);
    expect(sdkMetricsMock.PeriodicExportingMetricReader).toHaveBeenCalledTimes(1);
    expect(periodicExportingMetricReaderArgs.exporter).toBeInstanceOf(ConsoleMetricExporter);
    expect(periodicExportingMetricReaderArgs.exportIntervalMillis).toBe(20000);
  });

  it('should start the OpenTelemetry SDK with the http exporters', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      tracing: {
        enabled: true,
        exporter: OpenTelemetryExporter.HTTP,
      },
      metrics: {
        enabled: true,
        exporter: OpenTelemetryExporter.HTTP,
      },
    });

    await getApiConfiguration();

    // @ts-ignore
    const nodeSdkArgs = sdkNodeMock.NodeSDK.mock.calls[0]![0];
    // @ts-ignore
    const periodicExportingMetricReaderArgs = sdkMetricsMock.PeriodicExportingMetricReader.mock.calls[0]![0];
    expect(sdkNodeMock.NodeSDK).toHaveBeenCalledTimes(1);
    expect(nodeSdkArgs?.traceExporter).toBeInstanceOf(OTLPTraceExporterHttp);
    expect(nodeSdkArgs?.sampler).toBeInstanceOf(AlwaysOnSampler);
    expect(nodeSdkArgs?.spanProcessors).toHaveLength(1);
    expect(nodeSdkArgs!.spanProcessors![0]).toBeInstanceOf(BatchSpanProcessor);
    expect(sdkMetricsMock.PeriodicExportingMetricReader).toHaveBeenCalledTimes(1);
    expect(periodicExportingMetricReaderArgs.exporter).toBeInstanceOf(OTLPMetricExporterHttp);
    expect(periodicExportingMetricReaderArgs.exportIntervalMillis).toBe(10000);
  });

  it('should start the OpenTelemetry SDK with the grpc exporters', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      tracing: {
        enabled: true,
        exporter: OpenTelemetryExporter.GRPC,
      },
      metrics: {
        enabled: true,
        exporter: OpenTelemetryExporter.GRPC,
      },
    });

    await getApiConfiguration();

    // @ts-ignore
    const nodeSdkArgs = sdkNodeMock.NodeSDK.mock.calls[0]![0];
    // @ts-ignore
    const periodicExportingMetricReaderArgs = sdkMetricsMock.PeriodicExportingMetricReader.mock.calls[0]![0];
    expect(sdkNodeMock.NodeSDK).toHaveBeenCalledTimes(1);
    expect(nodeSdkArgs?.traceExporter).toBeInstanceOf(OTLPTraceExporterGrpc);
    expect(nodeSdkArgs?.sampler).toBeInstanceOf(AlwaysOnSampler);
    expect(nodeSdkArgs?.spanProcessors).toHaveLength(1);
    expect(nodeSdkArgs!.spanProcessors![0]).toBeInstanceOf(BatchSpanProcessor);
    expect(sdkMetricsMock.PeriodicExportingMetricReader).toHaveBeenCalledTimes(1);
    expect(periodicExportingMetricReaderArgs.exporter).toBeInstanceOf(OTLPMetricExporterGrpc);
    expect(periodicExportingMetricReaderArgs.exportIntervalMillis).toBe(10000);
  });

  it('should start the OpenTelemetry SDK with the protobuff exporters', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      tracing: {
        enabled: true,
        exporter: OpenTelemetryExporter.PROTOBUFF,
      },
      metrics: {
        enabled: true,
        exporter: OpenTelemetryExporter.PROTOBUFF,
      },
    });

    await getApiConfiguration();

    // @ts-ignore
    const nodeSdkArgs = sdkNodeMock.NodeSDK.mock.calls[0]![0];
    // @ts-ignore
    const periodicExportingMetricReaderArgs = sdkMetricsMock.PeriodicExportingMetricReader.mock.calls[0]![0];
    expect(sdkNodeMock.NodeSDK).toHaveBeenCalledTimes(1);
    expect(nodeSdkArgs?.traceExporter).toBeInstanceOf(OTLPTraceExporterProto);
    expect(nodeSdkArgs?.sampler).toBeInstanceOf(AlwaysOnSampler);
    expect(nodeSdkArgs?.spanProcessors).toHaveLength(1);
    expect(nodeSdkArgs!.spanProcessors![0]).toBeInstanceOf(BatchSpanProcessor);
    expect(sdkMetricsMock.PeriodicExportingMetricReader).toHaveBeenCalledTimes(1);
    expect(periodicExportingMetricReaderArgs.exporter).toBeInstanceOf(OTLPMetricExporterProto);
    expect(periodicExportingMetricReaderArgs.exportIntervalMillis).toBe(10000);
  });

  it('should not add a metrics reader if metrics are disabled', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      tracing: {
        enabled: true,
      },
      metrics: {
        enabled: false,
      },
    });

    await getApiConfiguration();

    // @ts-ignore
    const nodeSdkArgs = sdkNodeMock.NodeSDK.mock.calls[0]![0];
    expect(sdkNodeMock.NodeSDK).toHaveBeenCalledTimes(1);
    expect(nodeSdkArgs?.traceExporter).toBeInstanceOf(ConsoleSpanExporter);
    expect(nodeSdkArgs?.sampler).toBeInstanceOf(AlwaysOnSampler);
    expect(nodeSdkArgs?.spanProcessors).toHaveLength(1);
    expect(nodeSdkArgs!.spanProcessors![0]).toBeInstanceOf(BatchSpanProcessor);
    expect(nodeSdkArgs?.metricReader).toBeUndefined();
  });

  it('should not set a traceExporter and spanProcessor if tracing is disabled', async () => {
    // @ts-ignore
    fsExtraMock.default.readdir.mockResolvedValue(['cache-nest-config.json']);
    // @ts-ignore
    fsExtraMock.default.readJSON.mockResolvedValue({
      tracing: {
        enabled: false,
      },
      metrics: {
        enabled: true,
      },
    });

    await getApiConfiguration();

    // @ts-ignore
    const nodeSdkArgs = sdkNodeMock.NodeSDK.mock.calls[0]![0];
    expect(sdkNodeMock.NodeSDK).toHaveBeenCalledTimes(1);
    expect(nodeSdkArgs?.traceExporter).toBeUndefined();
    expect(nodeSdkArgs?.sampler).toBeInstanceOf(AlwaysOnSampler);
    expect(nodeSdkArgs?.spanProcessors).toBeUndefined();
  });
});
