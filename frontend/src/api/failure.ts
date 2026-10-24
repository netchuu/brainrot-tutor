import { ApiError, ContractError, RequestTimeoutError, StreamParseError, StreamTimeoutError } from '@/api/client'
import { ru } from '@/strings'
import type { FailureKind } from '@/strings'

export interface Failure {
  kind: FailureKind
  message: string
  retryable: boolean
}

export function failure(kind: FailureKind, retryable: boolean): Failure {
  return { kind, message: ru.errors[kind], retryable }
}

export function toFailure(error: unknown): Failure {
  if (error instanceof ApiError) return failure(error.code, error.retryable)
  if (error instanceof StreamTimeoutError || error instanceof RequestTimeoutError) return failure('timeout', true)
  if (error instanceof ContractError || error instanceof StreamParseError) return failure('broken', true)
  if (error instanceof TypeError) return failure('network', true)
  return failure('unknown', true)
}
