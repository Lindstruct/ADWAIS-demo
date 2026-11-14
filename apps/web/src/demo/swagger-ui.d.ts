declare module 'swagger-ui-dist/swagger-ui-bundle.js' {
  interface SwaggerRequest extends Omit<RequestInit, 'headers'> {
    url: string;
    headers?: Record<string, string>;
    userFetch?: (url: string, init: RequestInit) => Promise<Response>;
  }

  export default function SwaggerUI(options: {
    domNode: HTMLElement;
    url: string;
    validatorUrl: null;
    deepLinking: boolean;
    docExpansion: 'none';
    filter: boolean;
    requestInterceptor: (request: SwaggerRequest) => SwaggerRequest;
  }): void;
}
