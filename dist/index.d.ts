import { StoreApi } from 'zustand';
type Listener<T> = (val: T) => void;
export type Subscribe<T> = (listener: Listener<T>) => Unsubscribe;
type Unsubscribe = () => void;
type LoaderParams<T> = {
    id: string;
    run: LoaderFunc<T>;
    unloadDelayMS?: number;
};
type Eventable = {
    addEventListener: (type: string, cb: (e: any) => void) => void;
    removeEventListener: (type: string, cb: (e: any) => void) => void;
};
export type UseApi = {
    <T>(func: LoaderFunc<T>, id: string): Promise<T>;
    <T>(loader: ToLoader<T>): Promise<T>;
    schedule: (ms: number) => void;
    key: (key: any) => void;
    zustand: {
        <T>(store: StoreApi<T>): T;
        <T, A>(id: string, store: StoreApi<T>, selector: (val: T) => A): A;
    };
    subscribe: {
        <T>(id: string, subscribe: Subscribe<T>): T;
        <T, A>(id: string, subscribe: Subscribe<T>, selector: (val: T) => A): A;
    };
    cleanup: (cleanup: () => void) => void;
    event: {
        <T extends Event>(elem: Eventable, eventKey: string): T | undefined;
    };
};
type ToLoader<T> = LoaderParams<T> | Loader<T>;
export type LoaderFunc<T> = (use: UseApi, prev: T | undefined) => Promise<T>;
export type NamedLoaderFunc<T> = (use: UseApi, prev: T) => Promise<T>;
export declare const loaderCache: {
    [id: string]: Loader<any>;
};
type GoMode = ("CACHED" | // Return cached value or run for first time
"TRIGGER");
export declare class Loader<T> implements Loader<T> {
    #private;
    readonly id: string;
    private nextSubId;
    private last;
    private subscribers;
    private request;
    private subscriptions;
    private runTimeout;
    private unloadTimeout;
    private unloadDelayMS;
    private cleanup;
    readonly run: LoaderFunc<T>;
    constructor(params: LoaderParams<T>);
    subscribe(listener: Listener<T>, reason?: string): Unsubscribe;
    extend<O>(suffix: string, f: (val: T) => Promise<O>): Loader<O>;
    getState(): T | undefined;
    once(): Promise<T | undefined>;
    trigger(): Promise<T>;
    go(mode?: GoMode, _reason?: string): Promise<T>;
    checkStop(): void;
    static from<A>(arg: ToLoader<A>): Loader<A>;
}
export declare const useLoader: <T>(arg: ToLoader<T> | LoaderFunc<T>) => T | undefined;
export declare function runLoader<T>(arg: ToLoader<T> | LoaderFunc<T>): Promise<T>;
export declare function shallowCompare(prev: any, obj: any): boolean;
export declare function shallowCopy(val: any): any;
export declare const anyLoader: Loader<any>;
export {};
