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

import {register} from 'node:module';

// A loader hook only reaches modules imported after it registers, so this lives
// in its own module and is the first import of index.mjs, ahead of every
// instrumentation. import.meta.url resolves the hook against this package:
// import-in-the-middle sits in the library's own tree, not the consumer's.

const FALSEY = ['false', '0'];

const enabled = !FALSEY.includes((process.env.TRACING_NODE_ESM_HOOK ?? '').toLowerCase());

let failure = null;

if (enabled) {
  try {
    register('import-in-the-middle/hook.mjs', import.meta.url);
  } catch (error) {
    failure = error;
  }
}

/** Whether the ESM loader hook is in place, so ES module imports get patched. */
export const esmHookRegistered = enabled && failure === null;

/** The error that stopped registration, reported by index.mjs once diag has a logger. */
export const esmHookFailure = failure;
