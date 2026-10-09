var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, Module } from '@nestjs/common';
import { DependencyModule, RuntimeDependency } from './dependency.module.js';
let RuntimeConsumer = class RuntimeConsumer {
    dependency;
    constructor(dependency) {
        this.dependency = dependency;
    }
    run(value) {
        return this.dependency.describe(value);
    }
};
RuntimeConsumer = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [RuntimeDependency])
], RuntimeConsumer);
export { RuntimeConsumer };
let ConsumerModule = class ConsumerModule {
};
ConsumerModule = __decorate([
    Module({ imports: [DependencyModule], providers: [RuntimeConsumer] })
], ConsumerModule);
export { ConsumerModule };
let MissingDependencyModule = class MissingDependencyModule {
};
MissingDependencyModule = __decorate([
    Module({ providers: [RuntimeConsumer] })
], MissingDependencyModule);
export { MissingDependencyModule };
