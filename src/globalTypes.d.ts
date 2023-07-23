declare module 'json-stringify-pretty-compact' {
  type Options = {
    indent?: number;
  };
  function format(data: unknown, options?: Options): string;
  export = format;
}
