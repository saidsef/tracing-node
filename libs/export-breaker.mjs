/*
 * Copyright Said Sef
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {diag} from '@opentelemetry/api';
import {ExportResultCode} from '@opentelemetry/core';

export const FAILURE_THRESHOLD = 3;
export const BASE_COOLDOWN_MILLIS = 30000;
export const MAX_COOLDOWN_MILLIS = 300000;

// The metric reader reads these off its exporter, so the wrapper has to carry
// them or the reader falls back to its own temporality and aggregation.
const OPTIONAL_METHODS = ['selectAggregationTemporality', 'selectAggregation'];

// Drops every batch for a cooldown once `failureThreshold` exports in a row have
// failed, then lets one export through as a probe. A failed probe doubles the
// cooldown up to `maxCooldownMillis`, and any successful export closes it again.
export function withExportBreaker(exporter, {
  signal,
  failureThreshold = FAILURE_THRESHOLD,
  baseCooldownMillis = BASE_COOLDOWN_MILLIS,
  maxCooldownMillis = MAX_COOLDOWN_MILLIS,
  now = Date.now,
} = {}) {
  let failures = 0;
  let cooldownMillis = baseCooldownMillis;
  let openUntil = 0;
  let openedAt = 0;
  let probing = false;
  let dropped = 0;

  const isOpen = () => openUntil !== 0;

  const open = (error) => {
    openedAt = now();
    openUntil = openedAt + cooldownMillis;
    diag.warn(`OTLP ${signal} export failed ${failures} times in a row, dropping ${signal} for ${cooldownMillis / 1000}s: ${error?.message ?? 'unknown error'}`);
  };

  const close = () => {
    diag.info(`OTLP ${signal} export recovered after ${Math.round((now() - openedAt) / 1000)}s, ${dropped} batches dropped.`);
    failures = 0;
    cooldownMillis = baseCooldownMillis;
    openUntil = 0;
    dropped = 0;
  };

  const onResult = (result, isProbe) => {
    if (isProbe) probing = false;

    if (result.code === ExportResultCode.SUCCESS) {
      if (isOpen()) close();
      else failures = 0;
      return;
    }

    if (isProbe) {
      cooldownMillis = Math.min(cooldownMillis * 2, maxCooldownMillis);
      openUntil = now() + cooldownMillis;
      diag.debug(`OTLP ${signal} probe failed, next attempt in ${cooldownMillis / 1000}s.`);
    } else if (!isOpen() && ++failures >= failureThreshold) {
      open(result.error);
    }
  };

  const breaker = {
    export(items, resultCallback) {
      let isProbe = false;
      if (isOpen()) {
        // The processors never retry a failed batch, so reporting a dropped one
        // as a success loses nothing and spares the console an error per batch.
        if (probing || now() < openUntil) {
          dropped += 1;
          resultCallback({code: ExportResultCode.SUCCESS});
          return;
        }
        probing = true;
        isProbe = true;
      }

      exporter.export(items, (result) => {
        onResult(result, isProbe);
        resultCallback(result);
      });
    },
    forceFlush: () => exporter.forceFlush(),
    shutdown: () => exporter.shutdown(),
  };

  for (const method of OPTIONAL_METHODS) {
    if (typeof exporter[method] === 'function') {
      breaker[method] = exporter[method].bind(exporter);
    }
  }

  return breaker;
}
