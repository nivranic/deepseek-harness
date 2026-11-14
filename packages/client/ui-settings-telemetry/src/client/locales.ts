/** Telemetry consent section copy; the section owns its whole page. */

import type { TelemetryDataKind } from '@deepseek-ai/dsh-session-telemetry'

/** Section-level copy keys plus one name and one description key per data kind. */
export type TelemetrySettingsLocaleKey =
  | 'nav'
  | 'title'
  | 'subtitle'
  | 'loading'
  | 'readonlyHint'
  | 'writeNotApplied'
  | `kind.${TelemetryDataKind}`
  | `desc.${TelemetryDataKind}`

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '遥测',
  'title': '遥测共享',
  'subtitle': '选择此宿主可以共享哪些数据类别。每一类都是独立开关，且在你打开之前始终保持关闭。',
  'loading': '正在读取遥测同意设置',
  'readonlyHint': '此宿主的设置文档不接受更改。',
  'writeNotApplied': '无法保存更改，当前显示宿主已保存的值',
  'kind.sessionTelemetry': '会话遥测',
  'kind.providerMetadata': '提供商元数据',
  'kind.relayMetadata': '中继元数据',
  'kind.deviceTrustMetadata': '设备信任元数据',
  'kind.crashDiagnostics': '崩溃诊断',
  'desc.sessionTelemetry': '镜像自会话日志的会话记录，按已配置的上报后端共享。',
  'desc.providerMetadata': '每次请求使用的 LLM 提供商与模型。',
  'desc.relayMetadata': '请求在客户端与宿主之间的中继方式。',
  'desc.deviceTrustMetadata': '已配对设备的身份事实，例如设备名称与密钥指纹。',
  'desc.crashDiagnostics': '应用崩溃时产生的诊断记录。',
} satisfies Record<TelemetrySettingsLocaleKey, string>

/** English dictionary, checked complete against the zh key set. */
export const en: Record<TelemetrySettingsLocaleKey, string> = {
  'nav': 'Telemetry',
  'title': 'Telemetry sharing',
  'subtitle': 'Choose which data categories this Host may share. Each category is a separate switch, and every category stays off until you switch it on.',
  'loading': 'Reading telemetry consent',
  'readonlyHint': 'The settings document of this Host does not accept changes.',
  'writeNotApplied': 'Could not save this change. The current Host value is shown.',
  'kind.sessionTelemetry': 'Session telemetry',
  'kind.providerMetadata': 'Provider metadata',
  'kind.relayMetadata': 'Relay metadata',
  'kind.deviceTrustMetadata': 'Device Trust metadata',
  'kind.crashDiagnostics': 'Crash diagnostics',
  'desc.sessionTelemetry': 'Session records mirrored from the session log, shared through the configured reporting backend.',
  'desc.providerMetadata': 'Which LLM provider and model each request used.',
  'desc.relayMetadata': 'How requests were relayed between the Client and the Host.',
  'desc.deviceTrustMetadata': 'Paired-device identity facts, such as device names and key fingerprints.',
  'desc.crashDiagnostics': 'Diagnostic records produced when the application crashes.',
}

/** Japanese dictionary. */
export const ja = {
  'nav': 'テレメトリ',
  'title': 'テレメトリの共有',
  'subtitle': 'このホストが共有できるデータの種類を選択します。種類ごとに独立したスイッチがあり、有効にするまではすべてオフのままです。',
  'loading': 'テレメトリの同意設定を読み込み中',
  'readonlyHint': 'このホストの設定ドキュメントは変更を受け付けません。',
  'writeNotApplied': 'この変更を保存できませんでした。現在のホストの値を表示しています。',
  'kind.sessionTelemetry': 'セッションのテレメトリ',
  'kind.providerMetadata': 'プロバイダーのメタデータ',
  'kind.relayMetadata': 'リレーのメタデータ',
  'kind.deviceTrustMetadata': 'デバイス信頼のメタデータ',
  'kind.crashDiagnostics': 'クラッシュ診断',
  'desc.sessionTelemetry': 'セッションログから複製され、設定された報告バックエンドを通じて共有されるセッション記録。',
  'desc.providerMetadata': '各リクエストで使用した LLM プロバイダーとモデル。',
  'desc.relayMetadata': 'クライアントとホストの間でリクエストが中継された方法。',
  'desc.deviceTrustMetadata': 'デバイス名や鍵のフィンガープリントなど、ペアリング済みデバイスの識別情報。',
  'desc.crashDiagnostics': 'アプリケーションのクラッシュ時に生成される診断記録。',
}

/** Spanish dictionary. */
export const es = {
  'nav': 'Telemetría',
  'title': 'Compartir telemetría',
  'subtitle': 'Elige qué categorías de datos puede compartir este Host. Cada categoría tiene su propio interruptor y permanece desactivada hasta que la actives.',
  'loading': 'Leyendo el consentimiento de telemetría',
  'readonlyHint': 'El documento de configuración de este Host no admite cambios.',
  'writeNotApplied': 'No se pudo guardar este cambio. Se muestra el valor actual del Host.',
  'kind.sessionTelemetry': 'Telemetría de sesiones',
  'kind.providerMetadata': 'Metadatos del proveedor',
  'kind.relayMetadata': 'Metadatos de retransmisión',
  'kind.deviceTrustMetadata': 'Metadatos de confianza de dispositivos',
  'kind.crashDiagnostics': 'Diagnósticos de fallos',
  'desc.sessionTelemetry': 'Registros de sesión replicados desde el registro de sesiones y compartidos mediante el servicio de informes configurado.',
  'desc.providerMetadata': 'El proveedor de LLM y el modelo utilizados en cada solicitud.',
  'desc.relayMetadata': 'Cómo se retransmitieron las solicitudes entre el cliente y el Host.',
  'desc.deviceTrustMetadata': 'Datos de identidad de los dispositivos vinculados, como nombres y huellas de claves.',
  'desc.crashDiagnostics': 'Registros de diagnóstico generados cuando la aplicación falla.',
}

/** French dictionary. */
export const fr = {
  'nav': 'Télémétrie',
  'title': 'Partage de télémétrie',
  'subtitle': 'Choisissez les catégories de données que cet hôte peut partager. Chaque catégorie possède son propre interrupteur et reste désactivée tant que vous ne l’activez pas.',
  'loading': 'Lecture du consentement à la télémétrie',
  'readonlyHint': 'Le document de paramètres de cet hôte n’accepte pas les modifications.',
  'writeNotApplied': 'Impossible d’enregistrer cette modification. La valeur actuelle de l’hôte est affichée.',
  'kind.sessionTelemetry': 'Télémétrie des sessions',
  'kind.providerMetadata': 'Métadonnées du fournisseur',
  'kind.relayMetadata': 'Métadonnées du relais',
  'kind.deviceTrustMetadata': 'Métadonnées de confiance des appareils',
  'kind.crashDiagnostics': 'Diagnostics de plantage',
  'desc.sessionTelemetry': 'Enregistrements de session répliqués depuis le journal des sessions et partagés via le service de rapport configuré.',
  'desc.providerMetadata': 'Le fournisseur de LLM et le modèle utilisés pour chaque requête.',
  'desc.relayMetadata': 'La façon dont les requêtes ont été relayées entre le client et l’hôte.',
  'desc.deviceTrustMetadata': 'Informations d’identité des appareils associés, telles que leurs noms et les empreintes de leurs clés.',
  'desc.crashDiagnostics': 'Enregistrements de diagnostic produits lorsque l’application plante.',
}

/** German dictionary. */
export const de = {
  'nav': 'Telemetrie',
  'title': 'Telemetrie teilen',
  'subtitle': 'Wähle aus, welche Datenkategorien dieser Host teilen darf. Jede Kategorie hat einen eigenen Schalter und bleibt ausgeschaltet, bis du sie einschaltest.',
  'loading': 'Telemetrieeinwilligung wird gelesen',
  'readonlyHint': 'Das Einstellungsdokument dieses Hosts nimmt keine Änderungen an.',
  'writeNotApplied': 'Diese Änderung konnte nicht gespeichert werden. Der aktuelle Host-Wert wird angezeigt.',
  'kind.sessionTelemetry': 'Sitzungstelemetrie',
  'kind.providerMetadata': 'Anbietermetadaten',
  'kind.relayMetadata': 'Relay-Metadaten',
  'kind.deviceTrustMetadata': 'Metadaten zum Gerätevertrauen',
  'kind.crashDiagnostics': 'Absturzdiagnose',
  'desc.sessionTelemetry': 'Aus dem Sitzungsprotokoll übernommene Sitzungsdaten, die über den konfigurierten Meldedienst geteilt werden.',
  'desc.providerMetadata': 'Der bei jeder Anfrage verwendete LLM-Anbieter und das verwendete Modell.',
  'desc.relayMetadata': 'Wie Anfragen zwischen Client und Host weitergeleitet wurden.',
  'desc.deviceTrustMetadata': 'Identitätsdaten gekoppelter Geräte wie Gerätenamen und Schlüsselfingerabdrücke.',
  'desc.crashDiagnostics': 'Diagnoseaufzeichnungen, die bei einem Absturz der Anwendung entstehen.',
}

/** Russian dictionary. */
export const ru = {
  'nav': 'Телеметрия',
  'title': 'Передача телеметрии',
  'subtitle': 'Выберите категории данных, которыми может делиться этот хост. У каждой категории отдельный переключатель. Все они отключены, пока вы их не включите.',
  'loading': 'Чтение согласия на телеметрию',
  'readonlyHint': 'Документ настроек этого хоста не принимает изменения.',
  'writeNotApplied': 'Не удалось сохранить изменение. Показано текущее значение хоста.',
  'kind.sessionTelemetry': 'Телеметрия сеансов',
  'kind.providerMetadata': 'Метаданные поставщика',
  'kind.relayMetadata': 'Метаданные ретрансляции',
  'kind.deviceTrustMetadata': 'Метаданные доверия к устройствам',
  'kind.crashDiagnostics': 'Диагностика сбоев',
  'desc.sessionTelemetry': 'Записи сеансов, скопированные из журнала сеансов и передаваемые через настроенную службу отчётов.',
  'desc.providerMetadata': 'Поставщик LLM и модель, использованные для каждого запроса.',
  'desc.relayMetadata': 'Способ передачи запросов между клиентом и хостом.',
  'desc.deviceTrustMetadata': 'Сведения об идентичности сопряжённых устройств, включая имена устройств и отпечатки ключей.',
  'desc.crashDiagnostics': 'Диагностические записи, создаваемые при сбое приложения.',
}

/** Portuguese dictionary. */
export const pt = {
  'nav': 'Telemetria',
  'title': 'Partilha de telemetria',
  'subtitle': 'Escolha as categorias de dados que este Host pode partilhar. Cada categoria tem um interruptor independente e fica desligada até ser ativada.',
  'loading': 'A ler o consentimento de telemetria',
  'readonlyHint': 'O documento de definições deste Host não aceita alterações.',
  'writeNotApplied': 'Não foi possível guardar esta alteração. É apresentado o valor atual do Host.',
  'kind.sessionTelemetry': 'Telemetria de sessões',
  'kind.providerMetadata': 'Metadados do fornecedor',
  'kind.relayMetadata': 'Metadados de retransmissão',
  'kind.deviceTrustMetadata': 'Metadados de confiança dos dispositivos',
  'kind.crashDiagnostics': 'Diagnósticos de falhas',
  'desc.sessionTelemetry': 'Registos de sessões copiados do registo de sessões e partilhados através do serviço de relatórios configurado.',
  'desc.providerMetadata': 'O fornecedor de LLM e o modelo utilizados em cada pedido.',
  'desc.relayMetadata': 'Como os pedidos foram retransmitidos entre o cliente e o Host.',
  'desc.deviceTrustMetadata': 'Dados de identidade dos dispositivos emparelhados, como nomes e impressões digitais das chaves.',
  'desc.crashDiagnostics': 'Registos de diagnóstico produzidos quando a aplicação falha.',
}
