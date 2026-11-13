package com.qfirst.replay;

final class ReplayError extends RuntimeException {
    final int status;
    ReplayError(int status, String code) {
        super(code);
        this.status = status;
    }
}
