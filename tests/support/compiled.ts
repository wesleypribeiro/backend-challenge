// Os testes carregam o mesmo JavaScript emitido pelo build, com tipagem conferida nas fontes.
export async function compiled<T>(path: string): Promise<T> {
  return import(new URL(`../../${path}`, import.meta.url).href) as Promise<T>;
}
