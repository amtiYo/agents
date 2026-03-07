export class CancelledError extends Error {
  constructor(message = 'Operation canceled.') {
    super(message)
    this.name = 'CancelledError'
  }
}

