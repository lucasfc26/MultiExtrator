/**
 * Formatos e limites do Extrator. PROVISÓRIOS: o motor de extração de dados
 * ainda não existe. Quando o backend publicar os limites (ex.: na OpenAPI ou em
 * GET /extractions/config), substitua estes valores.
 */
export const EXTRACTOR_LIMITS = {
  accept: {
    'application/pdf': ['.pdf'],
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
  } as Record<string, string[]>,
  maxFileBytes: 10 * 1024 * 1024,
  maxFiles: 20,
}

export const ACCEPT_LABEL = 'PDF, PNG ou JPG'
