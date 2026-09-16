declare module 'word-extractor' {
  export default class WordExtractor {
    extract(buffer: Buffer): Promise<{
      getBody(): string
      getHeaders(): string
      getFooters(): string
      getAnnotations(): string
    }>
  }
}
