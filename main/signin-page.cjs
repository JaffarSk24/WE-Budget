// The page the desktop app shows in the web browser once Google has
// answered the sign-in. The browser tab is outside the app, so its texts
// live here in the main process, one entry per interface language; the
// renderer passes its language with the sign-in.

const TEXT = {
  ru: {
    okTitle: 'Готово',
    ok: 'Google-аккаунт подключён. Эту вкладку можно закрыть и вернуться в WE Budget.',
    failTitle: 'Не получилось',
    fail: 'Закройте вкладку и попробуйте войти ещё раз из приложения.',
    scopeTitle: 'Нет доступа к Google Диску',
    scope: 'На странице Google не была отмечена галочка доступа к Google Диску, а без неё синхронизация не работает. Закройте вкладку, нажмите в приложении «Войти через Google» ещё раз и отметьте доступ к Диску.'
  },
  uk: {
    okTitle: 'Готово',
    ok: 'Google-акаунт підключено. Цю вкладку можна закрити й повернутися до WE Budget.',
    failTitle: 'Не вдалося',
    fail: 'Закрийте вкладку та спробуйте увійти ще раз із застосунку.',
    scopeTitle: 'Немає доступу до Google Диска',
    scope: 'На сторінці Google не було позначено доступ до Google Диска, а без нього синхронізація не працює. Закрийте вкладку, натисніть у застосунку «Увійти через Google» ще раз і позначте доступ до Диска.'
  },
  en: {
    okTitle: 'Signed in',
    ok: 'Your Google account is connected. You can close this tab and return to WE Budget.',
    failTitle: 'Sign-in failed',
    fail: 'Close this tab and try again from the app.',
    scopeTitle: 'No access to Google Drive',
    scope: 'The Google Drive permission was not ticked on the Google page, and sync cannot work without it. Close this tab, choose Sign in with Google in the app again and tick the Google Drive permission.'
  },
  de: {
    okTitle: 'Angemeldet',
    ok: 'Dein Google-Konto ist verbunden. Du kannst diesen Tab schließen und zu WE Budget zurückkehren.',
    failTitle: 'Anmeldung fehlgeschlagen',
    fail: 'Schließe diesen Tab und versuche es in der App noch einmal.',
    scopeTitle: 'Kein Zugriff auf Google Drive',
    scope: 'Auf der Google-Seite wurde die Google-Drive-Berechtigung nicht angehakt, ohne sie funktioniert die Synchronisierung nicht. Schließe diesen Tab, wähle in der App erneut „Mit Google anmelden“ und hake die Google-Drive-Berechtigung an.'
  },
  es: {
    okTitle: 'Sesión iniciada',
    ok: 'Tu cuenta de Google está conectada. Puedes cerrar esta pestaña y volver a WE Budget.',
    failTitle: 'No se pudo iniciar sesión',
    fail: 'Cierra esta pestaña y vuelve a intentarlo desde la app.',
    scopeTitle: 'Sin acceso a Google Drive',
    scope: 'En la página de Google no se marcó el permiso de Google Drive, y la sincronización no funciona sin él. Cierra esta pestaña, elige "Iniciar sesión con Google" en la app otra vez y marca el permiso de Google Drive.'
  },
  sk: {
    okTitle: 'Prihlásené',
    ok: 'Váš účet Google je pripojený. Túto kartu môžete zavrieť a vrátiť sa do WE Budget.',
    failTitle: 'Prihlásenie zlyhalo',
    fail: 'Zatvorte túto kartu a skúste to znova z aplikácie.',
    scopeTitle: 'Bez prístupu k Disku Google',
    scope: 'Na stránke Google nebolo zaškrtnuté povolenie pre Disk Google a bez neho synchronizácia nefunguje. Zatvorte túto kartu, v aplikácii znova zvoľte „Prihlásiť sa cez Google“ a zaškrtnite povolenie pre Disk Google.'
  },
  cs: {
    okTitle: 'Přihlášeno',
    ok: 'Tvůj účet Google je připojený. Tuto kartu můžeš zavřít a vrátit se do WE Budget.',
    failTitle: 'Přihlášení se nezdařilo',
    fail: 'Zavři tuto kartu a zkus to znovu z aplikace.',
    scopeTitle: 'Chybí přístup k Disku Google',
    scope: 'Na stránce Google nebylo zaškrtnuto oprávnění pro Disk Google a bez něj synchronizace nefunguje. Zavři tuto kartu, v aplikaci znovu zvol „Přihlásit se přes Google“ a zaškrtni oprávnění pro Disk Google.'
  },
  fr: {
    okTitle: 'Connecté',
    ok: 'Votre compte Google est connecté. Vous pouvez fermer cet onglet et revenir à WE Budget.',
    failTitle: 'Échec de la connexion',
    fail: 'Fermez cet onglet et réessayez depuis l’app.',
    scopeTitle: 'Pas d’accès à Google Drive',
    scope: 'L’autorisation Google Drive n’a pas été cochée sur la page Google, et la synchronisation ne peut pas fonctionner sans elle. Fermez cet onglet, choisissez à nouveau « Se connecter avec Google » dans l’app et cochez l’autorisation Google Drive.'
  },
  pt: {
    okTitle: 'Login feito',
    ok: 'Sua conta Google está conectada. Você pode fechar esta aba e voltar ao WE Budget.',
    failTitle: 'Falha no login',
    fail: 'Feche esta aba e tente de novo pelo app.',
    scopeTitle: 'Sem acesso ao Google Drive',
    scope: 'A permissão do Google Drive não foi marcada na página do Google, e a sincronização não funciona sem ela. Feche esta aba, escolha "Entrar com o Google" no app de novo e marque a permissão do Google Drive.'
  },
  zh: {
    okTitle: '已登录',
    ok: '你的 Google 账户已连接。你可以关闭此标签页，返回 WE Budget。',
    failTitle: '登录失败',
    fail: '请关闭此标签页，然后在应用中重试。',
    scopeTitle: '无法访问 Google 云端硬盘',
    scope: '在 Google 页面上未勾选 Google 云端硬盘权限，没有它就无法同步。请关闭此标签页，在应用中再次选择“使用 Google 登录”，并勾选 Google 云端硬盘权限。'
  },
  hi: {
    okTitle: 'साइन इन हो गया',
    ok: 'आपका Google खाता जुड़ गया है। आप यह टैब बंद करके WE Budget पर लौट सकते हैं।',
    failTitle: 'साइन इन नहीं हो सका',
    fail: 'यह टैब बंद करें और ऐप से फिर से कोशिश करें।',
    scopeTitle: 'Google Drive तक पहुँच नहीं',
    scope: 'Google के पेज पर Google Drive की अनुमति पर टिक नहीं किया गया, और उसके बिना सिंक काम नहीं कर सकता। यह टैब बंद करें, ऐप में फिर से "Google से साइन इन करें" चुनें और Google Drive की अनुमति पर टिक करें।'
  },
  bn: {
    okTitle: 'সাইন ইন হয়েছে',
    ok: 'আপনার Google অ্যাকাউন্ট যুক্ত হয়েছে। এই ট্যাবটি বন্ধ করে WE Budget-এ ফিরে যেতে পারেন।',
    failTitle: 'সাইন ইন হয়নি',
    fail: 'এই ট্যাবটি বন্ধ করে অ্যাপ থেকে আবার চেষ্টা করুন।',
    scopeTitle: 'Google Drive-এ অ্যাক্সেস নেই',
    scope: 'Google-এর পেজে Google Drive-এর অনুমতিতে টিক দেওয়া হয়নি, এটি ছাড়া সিঙ্ক চলবে না। এই ট্যাবটি বন্ধ করুন, অ্যাপে আবার "Google দিয়ে সাইন ইন" বেছে নিন এবং Google Drive-এর অনুমতিতে টিক দিন।'
  },
  ar: {
    okTitle: 'تم تسجيل الدخول',
    ok: 'تم ربط حسابك في Google. يمكنك إغلاق علامة التبويب هذه والعودة إلى WE Budget.',
    failTitle: 'تعذّر تسجيل الدخول',
    fail: 'أغلق علامة التبويب هذه وحاول مجددًا من التطبيق.',
    scopeTitle: 'لا وصول إلى Google Drive',
    scope: 'لم يُحدَّد إذن Google Drive في صفحة Google، ولا تعمل المزامنة دونه. أغلق علامة التبويب هذه، واختر «تسجيل الدخول عبر Google» في التطبيق مجددًا وحدد إذن Google Drive.'
  },
  ur: {
    okTitle: 'سائن ان ہو گیا',
    ok: 'آپ کا Google اکاؤنٹ منسلک ہو گیا ہے۔ آپ یہ ٹیب بند کر کے WE Budget پر واپس جا سکتے ہیں۔',
    failTitle: 'سائن ان نہیں ہو سکا',
    fail: 'یہ ٹیب بند کریں اور ایپ سے دوبارہ کوشش کریں۔',
    scopeTitle: 'Google Drive تک رسائی نہیں',
    scope: 'Google کے صفحے پر Google Drive کی اجازت پر نشان نہیں لگا، اور اس کے بغیر سنک کام نہیں کر سکتا۔ یہ ٹیب بند کریں، ایپ میں دوبارہ "Google سے سائن ان کریں" چنیں اور Google Drive کی اجازت پر نشان لگائیں۔'
  }
};

const RTL = new Set(['ar', 'ur']);
const COLOR = { ok: '#22c55e', fail: '#f43f5e', scope: '#f59e0b' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// `outcome`: 'ok', 'fail' or 'scope' (the Google Drive permission was not
// ticked). An unknown language gets English.
function signInPage(lang, outcome) {
  const code = Object.prototype.hasOwnProperty.call(TEXT, lang) ? lang : 'en';
  const text = TEXT[code];
  const title = escapeHtml(text[`${outcome}Title`]);
  const message = escapeHtml(text[outcome]);
  return `<!DOCTYPE html><html lang="${code}" dir="${RTL.has(code) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0">
<div style="background:#1e293b;padding:40px;border-radius:16px;max-width:420px;text-align:center">
<h2 style="color:${COLOR[outcome]};margin:0 0 12px">${title}</h2>
<p style="color:#94a3b8;font-size:14px;margin:0;line-height:1.5">${message}</p></div></body></html>`;
}

module.exports = { signInPage, SIGNIN_LANGUAGES: Object.keys(TEXT) };
