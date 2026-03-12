import { TelemetryStore } from './db/schema';
export interface ServerOptions {
    store?: TelemetryStore;
}
export declare function createServer(options?: ServerOptions): {
    app: import("express-serve-static-core").Express;
    store: TelemetryStore;
};
//# sourceMappingURL=server.d.ts.map