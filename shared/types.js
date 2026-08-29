"use strict";
/**
 * 共享类型：Electron main（AI 层）与 renderer（React）共用的契约。
 * 设计文档第 5 节：AI Provider 抽象（参考 Cherry Studio）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiError = void 0;
class AiError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.AiError = AiError;
