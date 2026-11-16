/** `view-handoff` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'view-handoff'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action': '继续到其他设备',
  'copied': '已复制查看位置链接',
  'copyFailed': '复制失败，链接已显示',
  'scan': '在其他设备上扫码继续查看',
  'invalidLink': '查看位置链接无效，请重新复制链接',
  'wrongHost': '链接属于另一台主机，请打开原主机的页面',
  'unavailable': '连接已变化，请连接后重新打开链接',
  'openFailed': '无法打开查看位置，请确认会话仍可访问后重试',
} satisfies Record<string, string>

/** The view-handoff namespace key union. */
export type ViewHandoffKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en: Record<ViewHandoffKey, string> = {
  'action': 'Continue on another device',
  'copied': 'View-location link copied',
  'copyFailed': 'Copy failed; link shown instead',
  'scan': 'Scan on another device to continue viewing',
  'invalidLink': 'This view link is invalid. Copy a new link.',
  'wrongHost': 'This link belongs to another Host. Open its original page.',
  'unavailable': 'The connection changed. Connect and reopen the link.',
  'openFailed': 'The viewing position could not open. Check Session access and try again.',
}

/** Japanese dictionary. */
export const ja = {
  'action': '別のデバイスで続ける',
  'copied': '表示位置のリンクをコピーしました',
  'copyFailed': 'コピーできなかったため、リンクを表示しました',
  'scan': '別のデバイスでスキャンして閲覧を続ける',
  'invalidLink': 'この表示リンクは無効です。新しいリンクをコピーしてください。',
  'wrongHost': 'このリンクは別のホストのものです。元のページを開いてください。',
  'unavailable': '接続が変更されました。接続してからリンクを開き直してください。',
  'openFailed': '表示位置を開けませんでした。セッションへのアクセス権を確認して再試行してください。',
}

/** Spanish dictionary. */
export const es = {
  'action': 'Continuar en otro dispositivo',
  'copied': 'Enlace a la posición de vista copiado',
  'copyFailed': 'No se pudo copiar. Se muestra el enlace',
  'scan': 'Escanea en otro dispositivo para seguir viendo',
  'invalidLink': 'Este enlace de vista no es válido. Copia uno nuevo.',
  'wrongHost': 'Este enlace pertenece a otro Host. Abre su página original.',
  'unavailable': 'La conexión ha cambiado. Conéctate y vuelve a abrir el enlace.',
  'openFailed': 'No se pudo abrir la posición de vista. Comprueba el acceso a la sesión y vuelve a intentarlo.',
}

/** French dictionary. */
export const fr = {
  'action': 'Continuer sur un autre appareil',
  'copied': 'Lien vers la position d’affichage copié',
  'copyFailed': 'La copie a échoué. Le lien est affiché',
  'scan': 'Scannez sur un autre appareil pour continuer la consultation',
  'invalidLink': 'Ce lien d’affichage est invalide. Copiez un nouveau lien.',
  'wrongHost': 'Ce lien appartient à un autre hôte. Ouvrez sa page d’origine.',
  'unavailable': 'La connexion a changé. Connectez-vous et rouvrez le lien.',
  'openFailed': 'Impossible d’ouvrir la position d’affichage. Vérifiez l’accès à la session et réessayez.',
}

/** German dictionary. */
export const de = {
  'action': 'Auf einem anderen Gerät fortfahren',
  'copied': 'Link zur Ansichtsposition kopiert',
  'copyFailed': 'Kopieren fehlgeschlagen. Der Link wird angezeigt',
  'scan': 'Auf einem anderen Gerät scannen und weiter ansehen',
  'invalidLink': 'Dieser Ansichtslink ist ungültig. Kopiere einen neuen Link.',
  'wrongHost': 'Dieser Link gehört zu einem anderen Host. Öffne seine ursprüngliche Seite.',
  'unavailable': 'Die Verbindung hat sich geändert. Stelle eine Verbindung her und öffne den Link erneut.',
  'openFailed': 'Die Ansichtsposition konnte nicht geöffnet werden. Prüfe den Sitzungszugriff und versuche es erneut.',
}

/** Russian dictionary. */
export const ru = {
  'action': 'Продолжить на другом устройстве',
  'copied': 'Ссылка на позицию просмотра скопирована',
  'copyFailed': 'Не удалось скопировать. Ссылка показана',
  'scan': 'Отсканируйте на другом устройстве, чтобы продолжить просмотр',
  'invalidLink': 'Эта ссылка просмотра недействительна. Скопируйте новую.',
  'wrongHost': 'Эта ссылка принадлежит другому хосту. Откройте его исходную страницу.',
  'unavailable': 'Подключение изменилось. Подключитесь и откройте ссылку снова.',
  'openFailed': 'Не удалось открыть позицию просмотра. Проверьте доступ к сеансу и повторите попытку.',
}

/** Portuguese dictionary. */
export const pt = {
  'action': 'Continuar noutro dispositivo',
  'copied': 'Ligação para a posição de visualização copiada',
  'copyFailed': 'Não foi possível copiar. A ligação é apresentada',
  'scan': 'Leia o código noutro dispositivo para continuar a visualizar',
  'invalidLink': 'Esta ligação de visualização é inválida. Copie uma nova ligação.',
  'wrongHost': 'Esta ligação pertence a outro Host. Abra a página original.',
  'unavailable': 'A ligação foi alterada. Ligue-se e volte a abrir a ligação.',
  'openFailed': 'Não foi possível abrir a posição de visualização. Verifique o acesso à sessão e tente novamente.',
}
