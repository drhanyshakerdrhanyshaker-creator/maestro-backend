const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Mistral } = require('@mistralai/mistralai');

const app = express();
const PORT = 3000;

// ========== إعداد Mistral AI ==========
const mistral = new Mistral({ apiKey: 'aiNyD6VIL7qR8m4IVnCUlzW4LLsnxSWW' });
const MISTRAL_MODEL = 'mistral-large-latest'; // أقوى نموذج

// ========== الإعدادات الأساسية ==========
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

const { createClient } = require('@supabase/supabase-js');
const https = require('https');

// ========== إعداد Supabase ==========
const SUPABASE_URL = 'https://lgzyrynbhiujptthtbut.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnenlyeW5iaGl1anB0dGh0YnV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NzkwOTIsImV4cCI6MjA5NDQ1NTA5Mn0.edAtzefUaQFcrZJnkM8N80iD9fmNQ18davbGKIpMfs8';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== إعداد EmailJS ==========
const EMAILJS_SERVICE_ID  = 'service_tx8uhb4';
const EMAILJS_TEMPLATE_ID = 'template_45h7xka';
const EMAILJS_PUBLIC_KEY  = 'YOUR_EMAILJS_PUBLIC_KEY'; // ← ضع هنا Public Key

async function sendOTPEmail(toName, toEmail, otpCode) {
  if (EMAILJS_PUBLIC_KEY === 'YOUR_EMAILJS_PUBLIC_KEY') {
    console.log(`[تجريبي] OTP لـ ${toEmail}: ${otpCode}`);
    return false;
  }
  const payload = JSON.stringify({
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: { to_name: toName, to_email: toEmail, otp_code: otpCode }
  });
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.emailjs.com',
      path: '/api/v1.0/email/send',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(options, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', (e) => { console.error('EmailJS error:', e.message); resolve(false); });
    req.write(payload);
    req.end();
  });
}

// دالة تسجيل النشاط (تستخدم Supabase)
async function logActivity(userId, action, details) {
  if (!userId) return;
  try {
    await supabase.from('maestro_activity').insert({
      user_id: parseInt(userId), action, details,
      created_at: new Date().toISOString()
    });
  } catch (err) { console.error('خطأ تسجيل نشاط:', err.message); }
}

// Middleware: فحص حظر المستخدم
async function checkNotBlocked(req, res, next) {
  const userId = req.body?.userId || req.query?.userId;
  if (!userId) return next();
  const { data: user } = await supabase.from('maestro_users').select('is_blocked, role').eq('id', parseInt(userId)).maybeSingle();
  if (user?.is_blocked) return res.status(403).json({ error: 'تم حظر حسابك. تواصل مع الإدارة.', isBlocked: true });
  next();
}

// ========== إعداد رفع الملفات ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.txt', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('نوع الملف غير مدعوم'));
  }
});

// ========== تحميل قاعدة القوانين ==========
const LAWS_DIR = path.join(__dirname, '..');
const UPDATES_DIR = path.join(__dirname, 'updates');
let lawsDatabase = [];

function loadLaws() {
  console.log('🔄 جاري تحميل قاعدة القوانين...');
  if (!fs.existsSync(UPDATES_DIR)) fs.mkdirSync(UPDATES_DIR, { recursive: true });

  const lawFolders = [
    { id: 1, name: 'اللائحة التنفيذية لقانون الخدمة المدنية رقم 81 لسنة 2016', folder: '1- اللائحة التنفيذية لقانون الخدمة المدنية رقم 81 لسنة 2016', jsonFile: 'اللائحة التنفيذية لقانون الخدمة المدنية رقم 81 لسنة 2016.json' },
    { id: 2, name: 'اللائحة التنفيذية لقانون تنظيم الجامعات', folder: '2- اللائحة التنفيذية لقانون تنظيم الجامعات', jsonFile: 'اللائحة التنفيذية لقانون تنظيم الجامعات.json' },
    { id: 5, name: 'قانون التأمين الصحي الشامل رقم 2 لسنة 2018', folder: '5- قانون التأمين الصحي الشامل رقم 2 لسنة 2018', txtFile: 'قانون التأمين الصحي الشامل رقم 2 لسنة 2018.txt' },
    { id: 6, name: 'قانون التأمينات والمعاشات رقم 148 لسنة 2019', folder: '6- قانون التأمينات والمعاشات رقم ١٤٨ لسنة ٢٠١٩', jsonFile: 'قانون التأمينات والمعاشات رقم ١٤٨ لسنة ٢٠١٩.json' },
    { id: 7, name: 'قانون الخدمة المدنية رقم 81 لسنة 2016', folder: '7- قانون الخدمة المدنية رقم ٨١ لسنة ٢٠١٦', jsonFile: 'قانون الخدمة المدنية رقم ٨١ لسنة ٢٠١٦.json' },
    { id: 8, name: 'قانون السلطة القضائية رقم 46 لسنة 1972', folder: '8- قانون السلطة القضائية رقم 46 لسنة 1972', jsonFile: 'قانون السلطة القضائية رقم 46 لسنة 1972.json' },
    { id: 9, name: 'قانون العمل الجديد رقم 14 لسنة 2025', folder: '9- قانون العمل الجديد رقم ١٤ لسنة ٢٠٢٥', jsonFile: 'قانون العمل الجديد رقم ١٤ لسنة ٢٠٢٥.json' },
  ];

  const htmlFolders = [
    { id: 3, name: 'اللائحة التنفيذية لكادر المعلمين', folder: '3- اللائحة التنفيذية لكادر المعلمين' },
    { id: 10, name: 'قانون العمل رقم 12 لسنة 2003', folder: '10- قانون العمل رقم 12 لسنة 2003' },
    { id: 11, name: 'قانون تنظيم الجامعات رقم 49 لسنة 1972', folder: '11- قانون تنظيم الجامعات رقم ٤٩ لسنة ١٩٧٢' },
    { id: 12, name: 'قانون حقوق الأشخاص ذوي الإعاقة رقم 10 لسنة 2018', folder: '12- قانون حقوق الأشخاص ذوي الإعاقة رقم 10 لسنة 2018' },
    { id: 13, name: 'قانون كادر المعلمين رقم 155 لسنة 2007', folder: '13- قانون كادر المعلمين رقم ١٥٥ لسنة ٢٠٠٧' },
    { id: 4, name: 'تعديلات قانون المهن الطبية 2024', folder: '4- تعديلات قانون المهن الطبية ٢٠٢٤' },
  ];

  // تحميل JSON
  for (const law of lawFolders) {
    try {
      const lawPath = path.join(LAWS_DIR, law.folder);
      if (!fs.existsSync(lawPath)) continue;
      let content = '';
      if (law.jsonFile) {
        const jsonPath = path.join(lawPath, law.jsonFile);
        if (fs.existsSync(jsonPath)) {
          const raw = fs.readFileSync(jsonPath, 'utf8');
          try {
            const parsed = JSON.parse(raw);
            content = Array.isArray(parsed)
              ? parsed.map(p => stripHtml(p.content || '')).join('\n\n')
              : raw;
          } catch { content = raw; }
        }
      } else if (law.txtFile) {
        const txtPath = path.join(lawPath, law.txtFile);
        if (fs.existsSync(txtPath)) content = fs.readFileSync(txtPath, 'utf8');
      }
      if (content.trim()) {
        lawsDatabase.push({ id: law.id, name: law.name, content: content.trim() });
        console.log(`✅ ${law.name} (${Math.round(content.length / 1024)} KB)`);
      }
    } catch (err) { console.error(`❌ ${law.name}:`, err.message); }
  }

  // تحميل HTML
  for (const law of htmlFolders) {
    try {
      const lawPath = path.join(LAWS_DIR, law.folder);
      if (!fs.existsSync(lawPath)) continue;
      const htmlFiles = fs.readdirSync(lawPath)
        .filter(f => f.endsWith('.html'))
        .sort((a, b) => parseInt(a) - parseInt(b));
      let content = '';
      for (const f of htmlFiles) content += stripHtml(fs.readFileSync(path.join(lawPath, f), 'utf8')) + '\n\n';
      if (content.trim()) {
        lawsDatabase.push({ id: law.id, name: law.name, content: content.trim() });
        console.log(`✅ ${law.name} (${Math.round(content.length / 1024)} KB)`);
      }
    } catch (err) { console.error(`❌ ${law.name}:`, err.message); }
  }

  // تحميل الملف 14 (Markdown)
  try {
    const mdPath = path.join(LAWS_DIR, '14- نسخة مجمعة (قانون + لائحة)', 'datalab-output-نسخة مجمعة (قانون + لائحة).pdf.md');
    if (fs.existsSync(mdPath)) {
      const content = fs.readFileSync(mdPath, 'utf8');
      lawsDatabase.push({ id: 14, name: 'النسخة المجمعة - المعرفة القانونية لإدارة الموارد البشرية', content: content.trim() });
      console.log(`✅ الملف المجمع (${Math.round(content.length / 1024)} KB)`);
    }
  } catch (err) { console.error('❌ الملف المجمع:', err.message); }

  // تطبيق التحديثات المرفوعة يدوياً (Overrides)
  const updateFiles = fs.readdirSync(UPDATES_DIR);
  for (const file of updateFiles) {
    if (file.startsWith('law_') && file.endsWith('.txt')) {
      const lawId = parseInt(file.split('_')[1].split('.')[0]);
      const content = fs.readFileSync(path.join(UPDATES_DIR, file), 'utf8');
      const index = lawsDatabase.findIndex(l => l.id === lawId);
      if (index !== -1) {
        lawsDatabase[index].content = content.trim();
        console.log(`🔄 تم تطبيق تحديث كامل للقانون رقم ${lawId}`);
      }
    }
  }

  // تطبيق التعديلات الجزئية (Amendments)
  const amendmentsFile = path.join(UPDATES_DIR, 'amendments.json');
  if (fs.existsSync(amendmentsFile)) {
    try {
      const amendments = JSON.parse(fs.readFileSync(amendmentsFile, 'utf8'));
      for (const am of amendments) {
        const index = lawsDatabase.findIndex(l => l.id === parseInt(am.lawId));
        if (index !== -1) {
          lawsDatabase[index].content += `\n\n--- تعديلات حديثة تمت إضافتها ---\n${am.text}`;
          console.log(`📌 تم تطبيق تعديل جزئي للقانون رقم ${am.lawId}`);
        }
      }
    } catch (err) { console.error('❌ خطأ في قراءة ملف التعديلات الجزئية:', err.message); }
  }

  console.log(`\n🎉 تم تحميل ${lawsDatabase.length} مصدر قانوني بنجاح!\n`);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

// ========== محرك البحث ==========
function searchInLaws(query, restrictToLawIds = null) {
  const keywords = extractKeywords(query);
  const results = [];
  
  const targetLaws = restrictToLawIds 
    ? lawsDatabase.filter(l => restrictToLawIds.includes(l.id))
    : lawsDatabase;

  for (const law of targetLaws) {
    let score = 0;
    for (const kw of keywords) {
      if (kw.length < 2) continue;
      const matches = law.content.match(new RegExp(kw, 'gi'));
      if (matches) score += matches.length;
    }
    if (score > 0) {
      const articles = extractRelevantArticles(law.content, keywords);
      results.push({ law: law.name, lawId: law.id, score, articles: articles.slice(0, 5) });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 4);
}

function extractKeywords(query) {
  const stopWords = ['هل', 'ما', 'كيف', 'متى', 'أين', 'من', 'على', 'في', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'التي', 'الذي', 'يجوز', 'لا', 'وما', 'أن', 'عند', 'بعد', 'قبل'];
  return query.split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w))
    .map(w => w.replace(/[^\u0600-\u06FF\u0041-\u007A\u0030-\u0039]/g, ''));
}

function extractRelevantArticles(content, keywords) {
  const articles = [];
  const patterns = [
    /(?:المادة|مادة)\s*[(\[]?\s*[\d٠-٩]+\s*[)\]]?[:\s\n]([^\n]{50,600})/g,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      let score = 0;
      for (const kw of keywords) {
        if (kw.length > 2 && match[0].includes(kw)) score++;
      }
      if (score > 0) {
        const numMatch = match[0].match(/[\d٠-٩]+/);
        articles.push({ articleNum: numMatch ? numMatch[0] : '?', text: match[0].substring(0, 400), score });
      }
    }
  }
  return articles.sort((a, b) => b.score - a.score);
}

function buildContext(results, maxChars = 10000) {
  let ctx = '', remaining = maxChars;
  for (const r of results) {
    if (remaining <= 0) break;
    const header = `\n\n=== ${r.law} ===\n`;
    ctx += header; remaining -= header.length;
    if (r.articles.length > 0) {
      for (const a of r.articles) {
        const t = `مادة ${a.articleNum}: ${a.text}\n`;
        if (remaining > t.length) { ctx += t; remaining -= t.length; }
      }
    }
  }
  return ctx;
}

// ========== كشف الأسئلة غير القانونية ==========
function isLegalQuestion(message) {
  const legalKeywords = [
    'قانون', 'مادة', 'لائحة', 'حكم', 'حقوق', 'واجبات', 'عقوبة', 'غرامة',
    'محكمة', 'قضاء', 'قاضي', 'نيابة', 'دعوى', 'استئناف', 'طعن',
    'عقد', 'اتفاقية', 'التزام', 'مسؤولية', 'تعويض', 'ضرر',
    'موظف', 'وظيفة', 'خدمة مدنية', 'ترقية', 'إجازة', 'راتب', 'أجر',
    'تأمين', 'معاش', 'تقاعد', 'اشتراك', 'تأمينات',
    'عمل', 'عامل', 'صاحب عمل', 'فصل', 'انهاء', 'استقالة',
    'جامعة', 'تعليم', 'طالب', 'أستاذ', 'كلية', 'درجة علمية',
    'قضائية', 'سلطة', 'مستشار', 'إعاقة', 'ذوي الاحتياجات',
    'معلم', 'كادر', 'مهنة طبية', 'طبيب',
    'جزاء', 'تأديب', 'مخالفة', 'غياب', 'إنذار',
    'ندب', 'إعارة', 'نقل', 'انتداب',
    'مكافأة', 'علاوة', 'بدل', 'حافز',
    'شكوى', 'تظلم', 'اعتراض',
    'قانوني', 'شرعي', 'مشروع', 'مخالف', 'باطل', 'صحيح',
    'استشارة', 'رأي قانوني', 'حق', 'جريمة', 'سجن', 'حبس',
    'ميراث', 'وصية', 'طلاق', 'زواج', 'نفقة', 'حضانة',
    'ملكية', 'عقار', 'ايجار', 'بيع', 'شراء', 'رهن',
    'شركة', 'تجارة', 'ضريبة', 'رسوم', 'جمارك',
    'يجوز', 'يحق', 'يُحظر', 'يُمنع', 'يُلزم',
    'هل يجوز', 'هل يحق', 'ما العقوبة', 'كم المدة', 'ما الحكم',
    'ما شروط', 'كيف أتقدم', 'هل أستحق', 'ما إجراءات',
    'محضر', 'مجلس', 'قسم', 'كلية', 'عميد', 'دكتوراه', 'ماجستير', 
    'رسالة', 'تشكيل', 'إشراف', 'لجنة', 'جودة', 'اعتماد'
  ];
  const msg = message.toLowerCase();
  return legalKeywords.some(kw => msg.includes(kw));
}

const NON_LEGAL_RESPONSE = `عذراً، هذا السؤال لا يقع ضمن اختصاصي.

أنا **المايسترو القانوني**، متخصص حصراً في الاستفسارات والمسائل القانونية المصرية.

**يمكنني مساعدتك في:**
- ⚖️ الاستفسارات المتعلقة بقوانين الخدمة المدنية والعمل
- 📋 أحكام التأمينات والمعاشات والصحة
- 🏛️ قوانين الجامعات والتعليم والقضاء
- 📄 تحليل العقود والوثائق الرسمية قانونياً
- 🔍 تفسير المواد القانونية المصرية

يرجى إعادة صياغة سؤالك بما يتعلق بالشأن القانوني.

---
*🎓 هذا النظام من تدريب وتطوير **مايسترو التكنولوجيا***`;

const ATTRIBUTION = '\n\n---\n*🎓 هذا النظام من تدريب وتطوير **مايسترو التكنولوجيا***';

// ========== بناء System Prompt ==========
function buildSystemPrompt(context, source, lengthPref) {
  const lengthInstruction = lengthPref === 'short' 
    ? 'قدم إجابة مختصرة جداً، موجزة وسريعة، في بضعة أسطر فقط وبدون تفاصيل مفرطة.' 
    : 'قدم الإجابة بتفصيل شديد وعميق، مع تحليل شامل لكل الجوانب والمواد القانونية، واشرح التفاصيل بأسلوب منظم بالعناوين والنقاط.';

  const base = `أنت المايسترو القانوني، نظام ذكاء اصطناعي متخصص في القانون المصري، من تطوير مايسترو التكنولوجيا.

هويتك:
- مستشار قانوني مصري متخصص ومحترف
- تجيب باللغة العربية دائماً
- تستند فقط إلى القوانين المصرية الموثقة
- تذكر دائماً أرقام المواد القانونية التي استندت إليها

قواعد الإجابة:
1. اذكر دائماً رقم المادة والقانون المستشهد به بدقة
2. إذا لم تجد نصاً قانونياً محدداً، قل ذلك صراحةً
3. لا تُفتي بحكم إلا إذا كنت واثقاً 100% من المصدر
4. لا تخترع مواد قانونية غير موجودة
5. ${lengthInstruction}`;

  if (source === 'local' && context) {
    return `${base}\n\nالقوانين المتاحة للرجوع إليها:\n${context}\n\nاعتمد في إجابتك على هذه النصوص القانونية المحلية. اذكر أرقام المواد بدقة.`;
  }
  return `${base}\n\nملاحظة: لم يُعثر على نص قانوني محدد في قاعدة البيانات لهذا السؤال. اعتمد على معرفتك القانونية المصرية الأكاديمية، واذكر مصدرك. إذا لم تكن واثقاً، أنصح المستخدم بمراجعة محامٍ متخصص.`;
}

// ========== نظام تسجيل الدخول (Supabase) ==========

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isValidUniversityEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@sedu.asu.edu.eg');
}

app.post('/api/register', async (req, res) => {
  try {
    const { full_name, email, phone, job_title, password } = req.body;
    if (!full_name || !email || !password)
      return res.status(400).json({ error: 'الاسم والبريد الإلكتروني وكلمة المرور مطلوبة' });

    if (!isValidUniversityEmail(email))
      return res.status(400).json({ error: 'يُقبل فقط البريد الجامعي المنتهي بـ @sedu.asu.edu.eg' });

    const { data: existing } = await supabase
      .from('maestro_users').select('id').eq('email', email.toLowerCase()).maybeSingle();
    if (existing) return res.status(400).json({ error: 'هذا البريد الإلكتروني مسجّل بالفعل' });

    const { count } = await supabase.from('maestro_users').select('*', { count: 'exact', head: true });
    const role = (count === 0) ? 'admin' : 'user';

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { data: newUser, error } = await supabase.from('maestro_users').insert({
      full_name, email: email.toLowerCase(),
      phone: phone || null, job_title: job_title || null,
      password, role, is_verified: false,
      otp_code: otp, otp_expires_at: otpExpiry
    }).select().single();

    if (error) throw new Error(error.message);

    // إرسال الكود بالبريد
    await sendOTPEmail(full_name, email.toLowerCase(), otp);

    res.json({ success: true, requireVerification: true, userId: newUser.id, otp, userName: full_name, userEmail: email.toLowerCase() });
  } catch (error) {
    res.status(500).json({ error: 'خطأ في التسجيل: ' + error.message });
  }
});

app.post('/api/verify-email', async (req, res) => {
  try {
    const { userId, otp } = req.body;
    if (!userId || !otp) return res.status(400).json({ error: 'بيانات غير مكتملة' });

    const { data: user } = await supabase.from('maestro_users').select('*').eq('id', userId).single();
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.is_verified) return res.status(400).json({ error: 'الحساب مُفعَّل بالفعل' });
    if (user.otp_code !== otp.toString()) return res.status(400).json({ error: 'الكود غير صحيح' });
    if (new Date() > new Date(user.otp_expires_at))
      return res.status(400).json({ error: 'انتهت صلاحية الكود، يرجى التسجيل مرة أخرى' });

    await supabase.from('maestro_users').update({ is_verified: true, otp_code: null, otp_expires_at: null }).eq('id', userId);
    res.json({ success: true, user: { id: user.id, username: user.full_name, email: user.email, role: user.role, job_title: user.job_title } });
  } catch (error) {
    res.status(500).json({ error: 'خطأ: ' + error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });

    const { data: user } = await supabase.from('maestro_users').select('*')
      .eq('email', email.toLowerCase()).eq('password', password).maybeSingle();

    if (!user) return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    // إذا الحساب غير مفعّل، نعيد الـ OTP ونوجهه لشاشة التحقق
    if (!user.is_verified) {
      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await supabase.from('maestro_users').update({ otp_code: otp, otp_expires_at: otpExpiry }).eq('id', user.id);
      
      // إرسال الكود بالبريد
      await sendOTPEmail(user.full_name, user.email, otp);

      return res.status(403).json({
        error: 'الحساب غير مفعّل. تم إرسال رمز تحقق جديد!',
        requireVerification: true,
        userId: user.id,
        otp,
        userEmail: user.email,
        userName: user.full_name
      });
    }

    res.json({ success: true, user: { id: user.id, username: user.full_name, email: user.email, role: user.role, job_title: user.job_title } });
  } catch (error) {
    res.status(500).json({ error: 'خطأ: ' + error.message });
  }
});

// إعادة إرسال OTP
app.post('/api/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'البريد مطلوب' });
    const { data: user } = await supabase.from('maestro_users').select('*').eq('email', email.toLowerCase()).maybeSingle();
    if (!user) return res.status(404).json({ error: 'لا يوجد حساب بهذا البريد' });
    if (user.is_verified) return res.status(400).json({ error: 'الحساب مفعّل بالفعل' });
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await supabase.from('maestro_users').update({ otp_code: otp, otp_expires_at: otpExpiry }).eq('id', user.id);
    
    // إرسال الكود بالبريد
    await sendOTPEmail(user.full_name, user.email, otp);

    res.json({ success: true, userId: user.id, otp, userEmail: user.email, userName: user.full_name });
  } catch (error) {
    res.status(500).json({ error: 'خطأ: ' + error.message });
  }
});




// ========== API: جلب بيانات المستخدم الحالية ==========
app.get('/api/me/:id', async (req, res) => {
  try {
    const { data: user } = await supabase.from('maestro_users').select('*').eq('id', req.params.id).maybeSingle();
    if (!user) return res.status(404).json({ error: 'غير موجود' });
    if (user.is_blocked) return res.status(403).json({ error: 'محظور', isBlocked: true });
    res.json({ id: user.id, username: user.full_name, email: user.email, role: user.role, job_title: user.job_title });
  } catch(e) { res.status(500).json({error: e.message}); }
});

// ========== API: الدردشة والاستشارات ==========
app.post('/api/chat', checkNotBlocked, async (req, res) => {
  try {
    const { message, history, userId, lengthPref } = req.body;
    
    // تسجيل النشاط
    logActivity(userId, 'chat', `سؤال: ${message}`);
    if (!message?.trim()) return res.status(400).json({ error: 'الرسالة فارغة' });

    // فلتر الأسئلة غير القانونية
    if (!isLegalQuestion(message)) {
      return res.json({ response: NON_LEGAL_RESPONSE, source: 'filter', usedLaws: [], isNonLegal: true });
    }

    // البحث في القوانين المحلية
    const results = searchInLaws(message);
    const source = results.length > 0 ? 'local' : 'knowledge';
    const context = results.length > 0 ? buildContext(results) : '';
    const usedLaws = results.map(r => ({ name: r.law, id: r.lawId }));

    // بناء رسائل Mistral (system + history + user)
    const messages = [
      { role: 'system', content: buildSystemPrompt(context, source, lengthPref) }
    ];

    // إضافة التاريخ (user/assistant بالتناوب)
    const cleanHistory = [];
    let lastRole = null;
    for (const msg of history.slice(-10)) {
      const role = msg.role === 'user' ? 'user' : 'assistant';
      if (role !== lastRole) {
        cleanHistory.push({ role, content: msg.content });
        lastRole = role;
      }
    }
    // يجب أن يبدأ التاريخ بـ user
    while (cleanHistory.length > 0 && cleanHistory[0].role !== 'user') cleanHistory.shift();
    messages.push(...cleanHistory);

    // رسالة المستخدم الحالية
    messages.push({ role: 'user', content: message });

    // استدعاء Mistral API
    const response = await mistral.chat.complete({
      model: MISTRAL_MODEL,
      messages,
      temperature: 0.3,
      maxTokens: 2000,
    });

    const responseText = response.choices[0].message.content + ATTRIBUTION;

    res.json({ response: responseText, source, usedLaws, searchResults: results.length });

  } catch (error) {
    console.error('خطأ في الدردشة:', error.message);
    res.status(500).json({ error: 'حدث خطأ في النظام: ' + error.message });
  }
});

// ========== API: تحليل وثيقة عادية ==========
app.post('/api/analyze', upload.single('file'), checkNotBlocked, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم استلام أي ملف' });
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const userId = req.body.userId;
    
    // تسجيل النشاط
    logActivity(userId, 'upload_doc', `تحليل وثيقة: ${originalName}`);
    let fileContent = '';
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.txt' || ext === '.md') {
      fileContent = fs.readFileSync(req.file.path, 'utf8');
    } else if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        fileContent = (await pdfParse(fs.readFileSync(req.file.path))).text;
      } catch { fileContent = '[تعذّر قراءة محتوى PDF - تأكد أنه ملف نصي وليس صور مُسحوبة]'; }
    } else if (ext === '.doc' || ext === '.docx') {
      try {
        const mammoth = require('mammoth');
        fileContent = (await mammoth.extractRawText({ path: req.file.path })).value;
      } catch { fileContent = '[تعذّر قراءة ملف Word]'; }
    }

    if (!fileContent.trim()) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'لم يمكن استخراج نص من الملف' });
    }

    const results = searchInLaws(fileContent.substring(0, 500));
    const context = buildContext(results);

    const prompt = `أنت المايسترو القانوني، مستشار قانوني مصري متخصص من تطوير مايسترو التكنولوجيا. قم بتحليل المستند التالي قانونياً.

اسم الملف: ${originalName}

محتوى المستند:
${fileContent.substring(0, 6000)}

القوانين المرجعية:
${context || 'اعتمد على خبرتك القانونية المصرية'}

المطلوب:
1. 📋 ملخص المستند: ما الذي يتحدث عنه
2. ✅ الجوانب القانونية السليمة: ما يتوافق مع القانون المصري
3. ⚠️ الجوانب المشكوك فيها أو المخالفة للقانون
4. 📖 المواد القانونية المستشهد بها (أرقام المواد والقوانين تحديداً)
5. 💡 التوصيات القانونية: ما يجب تعديله
6. ⚖️ الحكم القانوني النهائي

---
🎓 هذا النظام من تدريب وتطوير مايسترو التكنولوجيا`;

    const response = await mistral.chat.complete({
      model: MISTRAL_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens: 3000,
    });

    const analysis = response.choices[0].message.content + ATTRIBUTION;
    fs.unlinkSync(req.file.path);

    res.json({ analysis, fileName: originalName, usedLaws: results.map(r => ({ name: r.law, id: r.lawId })), source: results.length > 0 ? 'local' : 'knowledge' });

  } catch (error) {
    console.error('خطأ في التحليل:', error.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'حدث خطأ في التحليل: ' + error.message });
  }
});

// ========== API: تحليل محضر مجلس قسم ==========
app.post('/api/analyze-council', upload.single('file'), checkNotBlocked, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم استلام محضر المجلس' });
    const filePath = req.file.path;
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const userId = req.body.userId;

    // تسجيل النشاط
    logActivity(userId, 'upload_council', `تحليل محضر مجلس: ${originalName}`);
    let fileContent = '';
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.txt' || ext === '.md') {
      fileContent = fs.readFileSync(filePath, 'utf8');
    } else if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        fileContent = (await pdfParse(fs.readFileSync(filePath))).text;
      } catch { fileContent = '[تعذّر قراءة محتوى PDF]'; }
    } else if (ext === '.doc' || ext === '.docx') {
      try {
        const mammoth = require('mammoth');
        fileContent = (await mammoth.extractRawText({ path: filePath })).value;
      } catch { fileContent = '[تعذّر قراءة ملف Word]'; }
    }

    if (!fileContent.trim()) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'لم يمكن استخراج نص من الملف' });
    }

    // نجلب القوانين المتعلقة بتنظيم الجامعات حصرياً (ID: 2, 11)
    const results = searchInLaws("قانون تنظيم الجامعات رقم 49 لسنة 1972 ولائحته التنفيذية مجالس الأقسام تشكيل لجان المناقشة والحكم الإشراف على الرسائل", [2, 11]);
    const context = buildContext(results, 15000);

    const prompt = `أنت المايسترو القانوني، مستشار قانوني مصري متخصص في شؤون الجامعات، من تطوير مايسترو التكنولوجيا.
المهمة: تحليل وتفكيك محضر مجلس قسم (قسم التربية الموسيقية - كلية التربية النوعية - جامعة عين شمس).

محتوى المحضر:
${fileContent.substring(0, 15000)}

القوانين المرجعية الأساسية:
${context || 'اعتمد على قانون تنظيم الجامعات رقم 49 لسنة 1972 ولائحته التنفيذية'}

المطلوب إخراج تقرير مفصل ومنسق كالتالي:
1. 📋 **بيانات المحضر**: تاريخ الانعقاد، الجهة.
2. **تفكيك الموضوعات**: قم بتحليل كل موضوع/بند في المحضر على حدة (مثل تشكيل لجان الفحص، إلغاء القيد، تقارير الإشراف، إلخ).
لكل موضوع اذكر:
- **ملخص الموضوع**
- **الرأي القانوني**: (استخدم ✅ لكتابة "موافق للقانون" إذا كان سليماً، أو ❌ لكتابة "مخالف للقانون" أو ⚠️ لـ "يحتاج مراجعة").
- **السند القانوني**: اذكر بالتحديد أرقام المواد من قانون تنظيم الجامعات أو لائحته التنفيذية التي تدعم هذا الرأي.
- **التوصية**: ماذا يجب على مجلس القسم فعله حيال هذا البند.
في نهاية كل بند، ضع الكلمة التالية نصاً كما هي بدون أي إضافات: [ناقش]

تأكد من استخدام علامة ✅ للبنود السليمة وعلامة ❌ أو ⚠️ للمخالفات ليتم تلوينها في النظام.

---
🎓 هذا النظام من تدريب وتطوير مايسترو التكنولوجيا`;

    const response = await mistral.chat.complete({
      model: MISTRAL_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens: 4000,
    });

    const analysis = response.choices[0].message.content + ATTRIBUTION;
    fs.unlinkSync(filePath);

    res.json({ analysis, fileName: originalName, usedLaws: results.map(r => ({ name: r.law, id: r.lawId })), source: 'local' });

  } catch (error) {
    console.error('خطأ في تحليل محضر المجلس:', error.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'حدث خطأ في تحليل محضر المجلس: ' + error.message });
  }
});

// ========== API: قائمة القوانين ==========
app.get('/api/laws', (req, res) => {
  res.json(lawsDatabase.map(l => ({ id: l.id, name: l.name, size: Math.round(l.content.length / 1024) + ' KB' })));
});

// ========== API: واجهة الإدارة ==========
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

app.post('/api/admin/check-updates', async (req, res) => {
  try {
    const prompt = `ابحث بشكل عام وأعطني أحدث التعديلات أو الأخبار حول القوانين المصرية التالية لعام 2024 و 2025:
- قانون العمل المصري
- قانون تنظيم الجامعات
- قانون الخدمة المدنية
- قانون التأمينات والمعاشات

أعطني إجابة مختصرة جداً، وفي حال وجود تعديلات، ضع اسم التعديل وتاريخه، وضع روابط للمصادر إن توفرت.
إذا لم تكن هناك تعديلات، قل "لا توجد تعديلات جوهرية حديثة".
تذكر: أنت تتحدث مع مدير النظام الذي يبحث عن تحديثات لرفعها.`;

    const response = await mistral.chat.complete({
      model: MISTRAL_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens: 1000,
    });

    res.json({ result: formatMarkdownForAdmin(response.choices[0].message.content) });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الاتصال بالذكاء الاصطناعي: ' + err.message });
  }
});

function formatMarkdownForAdmin(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>').replace(/^(.+)/, '<p>$1</p>');
}

app.post('/api/admin/update-law', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
    const targetLawId = parseInt(req.body.lawId);
    if (!targetLawId || isNaN(targetLawId)) return res.status(400).json({ error: 'معرف القانون غير صحيح' });

    const filePath = req.file.path;
    let fileContent = '';
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.txt' || ext === '.md') {
      fileContent = fs.readFileSync(filePath, 'utf8');
    } else if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        fileContent = (await pdfParse(fs.readFileSync(filePath))).text;
      } catch { fileContent = ''; }
    } else if (ext === '.doc' || ext === '.docx') {
      try {
        const mammoth = require('mammoth');
        fileContent = (await mammoth.extractRawText({ path: filePath })).value;
      } catch { fileContent = ''; }
    }

    fs.unlinkSync(filePath); // حذف الملف الأصلي من uploads

    if (!fileContent.trim()) {
      return res.status(400).json({ error: 'تعذر قراءة محتوى الملف المرفوع' });
    }

    // حفظ التحديث
    const updateFilePath = path.join(UPDATES_DIR, `law_${targetLawId}.txt`);
    fs.writeFileSync(updateFilePath, fileContent.trim(), 'utf8');

    // تحديث في الذاكرة
    const index = lawsDatabase.findIndex(l => l.id === targetLawId);
    if (index !== -1) {
      lawsDatabase[index].content = fileContent.trim();
    }

    res.json({ success: true, message: 'تم تحديث القانون بنجاح واعتماده في النظام.' });

  } catch (error) {
    console.error('خطأ في التحديث:', error.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'حدث خطأ: ' + error.message });
  }
});

app.post('/api/admin/add-amendment', (req, res) => {
  try {
    const { lawId, text } = req.body;
    if (!lawId || !text || !text.trim()) {
      return res.status(400).json({ error: 'البيانات غير مكتملة' });
    }

    const targetLawId = parseInt(lawId);
    const index = lawsDatabase.findIndex(l => l.id === targetLawId);
    if (index === -1) {
      return res.status(404).json({ error: 'القانون غير موجود' });
    }

    const amendmentsFile = path.join(UPDATES_DIR, 'amendments.json');
    let amendments = [];
    if (fs.existsSync(amendmentsFile)) {
      amendments = JSON.parse(fs.readFileSync(amendmentsFile, 'utf8'));
    }

    amendments.push({ lawId: targetLawId, text: text.trim(), date: new Date().toISOString() });
    fs.writeFileSync(amendmentsFile, JSON.stringify(amendments, null, 2), 'utf8');

    // تحديث مباشر في الذاكرة
    lawsDatabase[index].content += `\n\n--- تعديلات حديثة تمت إضافتها ---\n${text.trim()}`;

    res.json({ success: true, message: 'تم اعتماد التعديل الجزئي وإضافته للقانون بنجاح.' });
  } catch (error) {
    console.error('خطأ في إضافة التعديل الجزئي:', error.message);
    res.status(500).json({ error: 'حدث خطأ: ' + error.message });
  }
});

// APIs لإدارة المستخدمين (Supabase)
app.get('/api/admin/users', async (req, res) => {
  const { data: users, error } = await supabase.from('maestro_users')
    .select('id, full_name, email, phone, job_title, role, is_verified, is_blocked, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(users.map(u => ({
    id: u.id,
    username: u.full_name,
    email: u.email,
    phone: u.phone,
    job_title: u.job_title,
    role: u.role,
    is_verified: u.is_verified,
    is_blocked: u.is_blocked,
    createdAt: u.created_at
  })));
});

app.post('/api/admin/update-role', async (req, res) => {
  const { userId, role } = req.body;
  if (!userId || !role) return res.status(400).json({ error: 'بيانات غير مكتملة' });
  const { error } = await supabase.from('maestro_users').update({ role }).eq('id', parseInt(userId));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get('/api/admin/user-activity/:id', async (req, res) => {
  const targetId = parseInt(req.params.id);
  const { data, error } = await supabase.from('maestro_activity')
    .select('*').eq('user_id', targetId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(a => ({ ...a, timestamp: a.created_at })));
});

app.delete('/api/admin/delete-user/:id', async (req, res) => {
  const targetId = parseInt(req.params.id);
  // حذف من جدول النشاط ثم من المستخدمين
  await supabase.from('maestro_activity').delete().eq('user_id', targetId);
  const { error } = await supabase.from('maestro_users').delete().eq('id', targetId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.post('/api/admin/toggle-block', async (req, res) => {
  const { userId, is_blocked } = req.body;
  if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
  const { error } = await supabase.from('maestro_users').update({ is_blocked }).eq('id', parseInt(userId));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ========== API: ملف المستخدم الشخصي ==========
app.get('/api/my-activity/:id', checkNotBlocked, async (req, res) => {
  const targetId = parseInt(req.params.id);
  const { data, error } = await supabase.from('maestro_activity')
    .select('*').eq('user_id', targetId).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(a => ({ ...a, timestamp: a.created_at })));
});

app.post('/api/change-password', checkNotBlocked, async (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;
  if (!userId || !oldPassword || !newPassword) return res.status(400).json({ error: 'بيانات غير مكتملة' });
  
  // التحقق من الباسورد القديم
  const { data: user } = await supabase.from('maestro_users').select('password').eq('id', parseInt(userId)).maybeSingle();
  if (!user || user.password !== oldPassword) {
    return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  }

  // تحديث الباسورد
  const { error } = await supabase.from('maestro_users').update({ password: newPassword }).eq('id', parseInt(userId));
  if (error) return res.status(500).json({ error: error.message });
  
  res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
});

// ========== API: صحة النظام ==========
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', lawsLoaded: lawsDatabase.length, timestamp: new Date().toISOString() });
});

// ========== تشغيل الخادم ==========
loadLaws();
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log('⚖️  المايسترو القانوني - نظام الاستشارات');
  console.log('    مشغّل بـ Mistral AI');
  console.log('='.repeat(50));
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`📚 القوانين: ${lawsDatabase.length} مصدر`);
  console.log('='.repeat(50) + '\n');
});
