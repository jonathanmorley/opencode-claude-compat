import { createLogger, type LoggerTestOverrides } from "../vendor/utils/logging/logger"
import { configureSharedSubunitLogger } from "../vendor/utils/logger"

import { LOG_FILENAME } from "./plugin-identity"

const logger = createLogger({ logFileName: LOG_FILENAME })

export const log = logger.log

configureSharedSubunitLogger(log)
export const getLogFilePath = logger.getLogFilePath

export function _setLoggerForTesting(overrides: LoggerTestOverrides): void {
  logger._setLoggerForTesting(overrides)
}

export function _resetLoggerForTesting(): void {
  logger._resetLoggerForTesting()
}

export function _flushForTesting(): void {
  logger._flushForTesting()
}
