/** Saved-Host roster section copy; the section owns its whole page. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '主机',
  'title': '已保存的主机',
  'subtitle': '本页保存的 Host。其他地址的主机需在其独立页面中访问。',
  'empty': '尚无已保存的主机',
  'current': '当前主机',
  'currentPage': '当前使用本页 Host',
  'moveUp': '上移',
  'moveDown': '下移',
  'rename': '重命名',
  'renameSave': '保存',
  'renameCancelled': '取消',
  'renameEmpty': '名称不能为空',
  'renameReset': '恢复原名',
  'pairingHint': '此主机无法在当前页面内连接，请打开它的独立页面。若需授权，请使用该主机当前的启动链接。',
  'openHost': '打开主机页面',
  'forget': '忘记',
  'inProcess': '本页会话',
  'lastConnectedAt': '上次连接 {time}',
} satisfies Record<string, string>

/** The hosts section namespace key union. */
export type HostsLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en: Record<HostsLocaleKey, string> = {
  'nav': 'Hosts',
  'title': 'Saved Hosts',
  'subtitle': 'Hosts saved by this page. Visit Hosts at other addresses in their own pages.',
  'empty': 'No saved Hosts yet',
  'current': 'Current Host',
  'currentPage': 'Using the page Host',
  'moveUp': 'Move up',
  'moveDown': 'Move down',
  'rename': 'Rename',
  'renameSave': 'Save',
  'renameCancelled': 'Cancel',
  'renameEmpty': 'The name cannot be empty',
  'renameReset': 'Reset name',
  'pairingHint': 'This Host cannot connect inside the current page. Open its own page; if authorization is needed, use that Host’s current launch link.',
  'openHost': 'Open Host page',
  'forget': 'Forget',
  'inProcess': 'In-page session',
  'lastConnectedAt': 'Last connected {time}',
}

/** Japanese dictionary. */
export const ja = {
  'nav': 'ホスト',
  'title': '保存済みホスト',
  'subtitle': 'このページに保存されたホストです。別のアドレスのホストは、それぞれのページで開いてください。',
  'empty': '保存済みのホストはありません',
  'current': '現在のホスト',
  'currentPage': 'このページのホストを使用中',
  'moveUp': '上へ移動',
  'moveDown': '下へ移動',
  'rename': '名前を変更',
  'renameSave': '保存',
  'renameCancelled': 'キャンセル',
  'renameEmpty': '名前は空にできません',
  'renameReset': '名前をリセット',
  'pairingHint': 'このホストには現在のページ内から接続できません。専用ページを開いてください。認証が必要な場合は、そのホストの現在の起動リンクを使用してください。',
  'openHost': 'ホストのページを開く',
  'forget': '保存を解除',
  'inProcess': 'ページ内セッション',
  'lastConnectedAt': '最終接続 {time}',
}

/** Spanish dictionary. */
export const es = {
  'nav': 'Hosts',
  'title': 'Hosts guardados',
  'subtitle': 'Hosts guardados por esta página. Abre los Hosts de otras direcciones en sus propias páginas.',
  'empty': 'Aún no hay Hosts guardados',
  'current': 'Host actual',
  'currentPage': 'Usando el Host de esta página',
  'moveUp': 'Subir',
  'moveDown': 'Bajar',
  'rename': 'Cambiar nombre',
  'renameSave': 'Guardar',
  'renameCancelled': 'Cancelar',
  'renameEmpty': 'El nombre no puede estar vacío',
  'renameReset': 'Restablecer nombre',
  'pairingHint': 'Este Host no puede conectarse dentro de la página actual. Abre su propia página y, si requiere autorización, usa su enlace de inicio actual.',
  'openHost': 'Abrir página del Host',
  'forget': 'Olvidar',
  'inProcess': 'Sesión en la página',
  'lastConnectedAt': 'Última conexión {time}',
}

/** French dictionary. */
export const fr = {
  'nav': 'Hôtes',
  'title': 'Hôtes enregistrés',
  'subtitle': 'Hôtes enregistrés par cette page. Ouvrez les hôtes situés à d’autres adresses dans leurs propres pages.',
  'empty': 'Aucun hôte enregistré',
  'current': 'Hôte actuel',
  'currentPage': 'Utilisation de l’hôte de cette page',
  'moveUp': 'Monter',
  'moveDown': 'Descendre',
  'rename': 'Renommer',
  'renameSave': 'Enregistrer',
  'renameCancelled': 'Annuler',
  'renameEmpty': 'Le nom ne peut pas être vide',
  'renameReset': 'Réinitialiser le nom',
  'pairingHint': 'Cet hôte ne peut pas se connecter dans la page actuelle. Ouvrez sa propre page et, si une autorisation est requise, utilisez son lien de lancement actuel.',
  'openHost': 'Ouvrir la page de l’hôte',
  'forget': 'Oublier',
  'inProcess': 'Session dans la page',
  'lastConnectedAt': 'Dernière connexion {time}',
}

/** German dictionary. */
export const de = {
  'nav': 'Hosts',
  'title': 'Gespeicherte Hosts',
  'subtitle': 'Von dieser Seite gespeicherte Hosts. Öffne Hosts mit anderen Adressen auf ihren eigenen Seiten.',
  'empty': 'Noch keine gespeicherten Hosts',
  'current': 'Aktueller Host',
  'currentPage': 'Host dieser Seite wird verwendet',
  'moveUp': 'Nach oben',
  'moveDown': 'Nach unten',
  'rename': 'Umbenennen',
  'renameSave': 'Speichern',
  'renameCancelled': 'Abbrechen',
  'renameEmpty': 'Der Name darf nicht leer sein',
  'renameReset': 'Namen zurücksetzen',
  'pairingHint': 'Dieser Host kann sich innerhalb der aktuellen Seite nicht verbinden. Öffne seine eigene Seite und verwende bei erforderlicher Autorisierung seinen aktuellen Startlink.',
  'openHost': 'Host-Seite öffnen',
  'forget': 'Vergessen',
  'inProcess': 'Sitzung auf dieser Seite',
  'lastConnectedAt': 'Zuletzt verbunden {time}',
}

/** Russian dictionary. */
export const ru = {
  'nav': 'Хосты',
  'title': 'Сохранённые хосты',
  'subtitle': 'Хосты, сохранённые этой страницей. Открывайте хосты с другими адресами на их собственных страницах.',
  'empty': 'Сохранённых хостов пока нет',
  'current': 'Текущий хост',
  'currentPage': 'Используется хост этой страницы',
  'moveUp': 'Переместить вверх',
  'moveDown': 'Переместить вниз',
  'rename': 'Переименовать',
  'renameSave': 'Сохранить',
  'renameCancelled': 'Отмена',
  'renameEmpty': 'Имя не может быть пустым',
  'renameReset': 'Сбросить имя',
  'pairingHint': 'Этот хост не может подключиться внутри текущей страницы. Откройте его собственную страницу, а при необходимости авторизации используйте его текущую ссылку запуска.',
  'openHost': 'Открыть страницу хоста',
  'forget': 'Забыть',
  'inProcess': 'Сеанс на странице',
  'lastConnectedAt': 'Последнее подключение {time}',
}

/** Portuguese dictionary. */
export const pt = {
  'nav': 'Hosts',
  'title': 'Hosts guardados',
  'subtitle': 'Hosts guardados por esta página. Abra os Hosts de outros endereços nas suas próprias páginas.',
  'empty': 'Ainda não há Hosts guardados',
  'current': 'Host atual',
  'currentPage': 'A utilizar o Host desta página',
  'moveUp': 'Mover para cima',
  'moveDown': 'Mover para baixo',
  'rename': 'Mudar nome',
  'renameSave': 'Guardar',
  'renameCancelled': 'Cancelar',
  'renameEmpty': 'O nome não pode estar vazio',
  'renameReset': 'Repor nome',
  'pairingHint': 'Este Host não pode ligar-se dentro da página atual. Abra a sua própria página e, se for necessária autorização, utilize a ligação de arranque atual desse Host.',
  'openHost': 'Abrir página do Host',
  'forget': 'Esquecer',
  'inProcess': 'Sessão na página',
  'lastConnectedAt': 'Última ligação {time}',
}
