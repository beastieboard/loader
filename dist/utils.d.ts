export declare function sleep(ms: number): Promise<unknown>;
export declare function isEmptyObject(obj: Object): boolean;
export declare function makeLater<T = any>(): {
    p: Promise<T>;
    resolve: any;
    reject: any;
};
