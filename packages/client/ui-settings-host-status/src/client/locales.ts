/** Host readiness section copy; the section owns its whole page. */

import type { ComponentHealth, HealthSnapshot } from '@deepseek-ai/dsh-api-host-diagnostics/client'

/** The six §41 health component names: every `HealthSnapshot` key except the derived `ready` verdict. */
export type HostStatusComponentName = Exclude<keyof HealthSnapshot, 'ready'>

/** Section-level copy keys plus one name key per health component and one state key per component state. */
export type HostStatusLocaleKey =
  | 'nav'
  | 'title'
  | 'subtitle'
  | 'ready'
  | 'notReady'
  | 'loading'
  | 'error'
  | 'retry'
  | `component.${HostStatusComponentName}`
  | `state.${ComponentHealth}`

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '宿主状态',
  'title': '宿主状态',
  'subtitle': '六个健康组件的当前状态，以及此宿主当前能否接受 Agent 请求的判定。',
  'ready': '可接受 Agent 请求',
  'notReady': '暂不能接受 Agent 请求',
  'loading': '正在读取宿主状态',
  'error': '无法读取宿主状态。',
  'retry': '重试',
  'component.process': '进程',
  'component.runtime': '运行时',
  'component.sessionStore': '会话存储',
  'component.pluginState': '插件状态',
  'component.connection': '连接',
  'component.modelProvider': '模型提供方',
  'state.up': '正常',
  'state.degraded': '降级',
  'state.down': '不可用',
} satisfies Record<HostStatusLocaleKey, string>

/** English dictionary, checked complete against the zh key set. */
export const en: Record<HostStatusLocaleKey, string> = {
  'nav': 'Host status',
  'title': 'Host status',
  'subtitle': 'The six health components and whether this Host can currently accept Agent requests.',
  'ready': 'Accepting agent requests',
  'notReady': 'Not accepting agent requests',
  'loading': 'Reading Host status',
  'error': 'The Host status could not be read.',
  'retry': 'Retry',
  'component.process': 'Process',
  'component.runtime': 'Runtime',
  'component.sessionStore': 'Session store',
  'component.pluginState': 'Plugin state',
  'component.connection': 'Connection',
  'component.modelProvider': 'Model provider',
  'state.up': 'Healthy',
  'state.degraded': 'Degraded',
  'state.down': 'Unavailable',
}

/** Japanese dictionary. */
export const ja = {
  'nav': 'ホストの状態',
  'title': 'ホストの状態',
  'subtitle': '6 つのヘルス項目と、このホストが現在エージェントのリクエストを受け付けられるかを表示します。',
  'ready': 'エージェントのリクエストを受付中',
  'notReady': 'エージェントのリクエストを受付停止中',
  'loading': 'ホストの状態を読み込み中',
  'error': 'ホストの状態を読み込めませんでした。',
  'retry': '再試行',
  'component.process': 'プロセス',
  'component.runtime': 'ランタイム',
  'component.sessionStore': 'セッションストア',
  'component.pluginState': 'プラグインの状態',
  'component.connection': '接続',
  'component.modelProvider': 'モデルプロバイダー',
  'state.up': '正常',
  'state.degraded': '機能低下',
  'state.down': '利用不可',
}

/** Spanish dictionary. */
export const es = {
  'nav': 'Estado del Host',
  'title': 'Estado del Host',
  'subtitle': 'Los seis componentes de salud y si este Host puede aceptar solicitudes de agentes actualmente.',
  'ready': 'Aceptando solicitudes de agentes',
  'notReady': 'Sin aceptar solicitudes de agentes',
  'loading': 'Leyendo el estado del Host',
  'error': 'No se pudo leer el estado del Host.',
  'retry': 'Reintentar',
  'component.process': 'Proceso',
  'component.runtime': 'Entorno de ejecución',
  'component.sessionStore': 'Almacén de sesiones',
  'component.pluginState': 'Estado de los plugins',
  'component.connection': 'Conexión',
  'component.modelProvider': 'Proveedor de modelos',
  'state.up': 'Correcto',
  'state.degraded': 'Degradado',
  'state.down': 'No disponible',
}

/** French dictionary. */
export const fr = {
  'nav': 'État de l’hôte',
  'title': 'État de l’hôte',
  'subtitle': 'Les six composants de santé et la capacité actuelle de cet hôte à accepter les requêtes des agents.',
  'ready': 'Accepte les requêtes des agents',
  'notReady': 'N’accepte pas les requêtes des agents',
  'loading': 'Lecture de l’état de l’hôte',
  'error': 'Impossible de lire l’état de l’hôte.',
  'retry': 'Réessayer',
  'component.process': 'Processus',
  'component.runtime': 'Environnement d’exécution',
  'component.sessionStore': 'Stockage des sessions',
  'component.pluginState': 'État des plugins',
  'component.connection': 'Connexion',
  'component.modelProvider': 'Fournisseur de modèles',
  'state.up': 'Opérationnel',
  'state.degraded': 'Dégradé',
  'state.down': 'Indisponible',
}

/** German dictionary. */
export const de = {
  'nav': 'Host-Status',
  'title': 'Host-Status',
  'subtitle': 'Die sechs Zustandskomponenten und ob dieser Host derzeit Agentenanfragen annehmen kann.',
  'ready': 'Agentenanfragen werden angenommen',
  'notReady': 'Agentenanfragen werden nicht angenommen',
  'loading': 'Host-Status wird gelesen',
  'error': 'Der Host-Status konnte nicht gelesen werden.',
  'retry': 'Erneut versuchen',
  'component.process': 'Prozess',
  'component.runtime': 'Laufzeit',
  'component.sessionStore': 'Sitzungsspeicher',
  'component.pluginState': 'Plugin-Status',
  'component.connection': 'Verbindung',
  'component.modelProvider': 'Modellanbieter',
  'state.up': 'Funktionsfähig',
  'state.degraded': 'Eingeschränkt',
  'state.down': 'Nicht verfügbar',
}

/** Russian dictionary. */
export const ru = {
  'nav': 'Состояние хоста',
  'title': 'Состояние хоста',
  'subtitle': 'Шесть компонентов состояния и возможность этого хоста принимать запросы агентов в данный момент.',
  'ready': 'Принимает запросы агентов',
  'notReady': 'Не принимает запросы агентов',
  'loading': 'Чтение состояния хоста',
  'error': 'Не удалось прочитать состояние хоста.',
  'retry': 'Повторить',
  'component.process': 'Процесс',
  'component.runtime': 'Среда выполнения',
  'component.sessionStore': 'Хранилище сеансов',
  'component.pluginState': 'Состояние плагинов',
  'component.connection': 'Подключение',
  'component.modelProvider': 'Поставщик моделей',
  'state.up': 'Исправен',
  'state.degraded': 'Работает с ограничениями',
  'state.down': 'Недоступен',
}

/** Portuguese dictionary. */
export const pt = {
  'nav': 'Estado do Host',
  'title': 'Estado do Host',
  'subtitle': 'Os seis componentes de estado e a capacidade atual deste Host para aceitar pedidos de agentes.',
  'ready': 'A aceitar pedidos de agentes',
  'notReady': 'Não está a aceitar pedidos de agentes',
  'loading': 'A ler o estado do Host',
  'error': 'Não foi possível ler o estado do Host.',
  'retry': 'Tentar novamente',
  'component.process': 'Processo',
  'component.runtime': 'Ambiente de execução',
  'component.sessionStore': 'Armazenamento de sessões',
  'component.pluginState': 'Estado dos plugins',
  'component.connection': 'Ligação',
  'component.modelProvider': 'Fornecedor de modelos',
  'state.up': 'Operacional',
  'state.degraded': 'Degradado',
  'state.down': 'Indisponível',
}
