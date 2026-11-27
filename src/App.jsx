import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Camera,
  Check,
  Volume2,
  RotateCcw,
  Layers,
  Sparkles,
  Trash2,
  Download,
  Upload,
  Globe,
  FileText,
  ArrowRight,
  ArrowLeft,
  Settings,
  Key,
  CheckCircle2,
  AlertCircle,
  Flame,
  Quote
} from 'lucide-react';

const SAMPLE_ARTICLE = `EM i friidrott slutade i söndags. Sverige vann flera medaljer de sista dagarna.
I lördags vann Andreas Almgren guld på 10 tusen meter. Han sprang ifrån alla och kom i mål nästan 20 sekunder före tvåan. Almgrens tid är nytt rekord för EM.
– Det kan inte bli bättre, säger Almgren.
Stavhopparen Armand Duplantis vann också guld. Han hoppade 6 meter och 15 centimeter. Det är nytt rekord för EM.
Men det var en svår tävlingsdag för Duplantis. Efteråt berättade han att han var magsjuk. Det hände efter att han ätit indisk mat till lunch.
– Jag har varit på toaletten hela dagen, sa Duplantis.`;

const STORAGE_KEY = 'linder_vocab_data_v1';
const API_KEY_STORAGE = 'linder_gemini_api_key';

export default function App() {
  const [activeTab, setActiveTab] = useState('import');
  const [vocabStore, setVocabStore] = useState({});
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // Import state
  const [articleText, setArticleText] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [imageMimeType, setImageMimeType] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState('');
  const [extractError, setExtractError] = useState('');

  // Triage (Swipe) state
  const [triageQueue, setTriageQueue] = useState([]);
  const [triageLang, setTriageLang] = useState(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);

  // Study (Flashcards) state
  const [selectedLang, setSelectedLang] = useState('');
  const [studyMode, setStudyMode] = useState('due');
  const [studyQueue, setStudyQueue] = useState([]);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, graduated: 0 });

  // Library state
  const [libraryFilter, setLibraryFilter] = useState('learning');
  const [bulkText, setBulkText] = useState('');
  const [bulkStatus, setBulkStatus] = useState('known');
  const [showBulkModal, setShowBulkModal] = useState(false);

  const fileInputRef = useRef(null);
  const backupInputRef = useRef(null);

  useEffect(() => {
    try {
      const savedVocab = localStorage.getItem(STORAGE_KEY);
      if (savedVocab) {
        const parsed = JSON.parse(savedVocab);
        setVocabStore(parsed);
        const langs = Object.keys(parsed);
        if (langs.length > 0) setSelectedLang(langs[0]);
      }
      const savedKey = localStorage.getItem(API_KEY_STORAGE);
      if (savedKey) {
        setApiKey(savedKey);
      } else {
        setShowSettings(true);
      }
    } catch (e) {
      console.error('Failed to load storage:', e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(vocabStore));
      const langs = Object.keys(vocabStore);
      if (langs.length > 0 && !selectedLang) {
        setSelectedLang(langs[0]);
      }
    } catch (e) {
      console.error('Failed to save vocab:', e);
    }
  }, [vocabStore, selectedLang]);

  const handleSaveApiKey = (val) => {
    setApiKey(val);
    localStorage.setItem(API_KEY_STORAGE, val.trim());
  };

  const speakWord = (text, langCode = 'sv-SE') => {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langCode;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      setImagePreview(result);
      const [header, base64] = result.split(',');
      const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
      setImageBase64(base64);
      setImageMimeType(mime);
    };
    reader.readAsDataURL(file);
  };

  const getAvailableModels = async (cleanKey) => {
    const fallbackList = ['gemini-3.8-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`
      );
      if (!res.ok) return fallbackList;
      const data = await res.json();

      const excludedKeywords = [
        'embedding',
        'imagen',
        'veo',
        'tts',
        'audio',
        'image',
        'robotics',
        'computer-use',
        'aqa',
        'bisect',
        'learnlm'
      ];

      const valid = (data.models || [])
        .filter((m) => {
          const lower = m.name.toLowerCase();
          return (
            m.supportedGenerationMethods?.includes('generateContent') &&
            lower.includes('gemini') &&
            !excludedKeywords.some((kw) => lower.includes(kw))
          );
        })
        .map((m) => m.name.replace('models/', ''));

      const prioritized = [
        ...valid.filter((n) => n.includes('flash') && !n.includes('thinking')),
        ...valid.filter((n) => n.includes('pro')),
        ...valid
      ];

      const unique = [...new Set(prioritized)];
      return unique.length > 0 ? unique : fallbackList;
    } catch {
      return fallbackList;
    }
  };

  const handleExtractWords = async () => {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      setShowSettings(true);
      setExtractError('先に右上の歯車アイコンから Gemini APIキー を設定してください。');
      return;
    }
    if (!articleText.trim() && !imageBase64) {
      setExtractError('記事のテキストを入力するか、写真を選択してください。');
      return;
    }

    setIsExtracting(true);
    setExtractError('');
    setExtractStatus('利用可能なAIモデルを確認中...');

    try {
      const prompt = `Detect the language of the provided article ("languageName" in Japanese, "languageCode" BCP-47).
Extract unique non-proper-noun vocabulary words in their lowercase dictionary base form ("lemma").
For each word provide:
- "lemma": lowercase dictionary base form
- "surface": exact form appearing in the article
- "pos": short part of speech in Japanese
- "meaningEn": concise English translation (1-3 meanings)
- "meaningJa": concise Japanese translation (1-3 meanings)
- "exampleSentence": the exact sentence from the article where this word appears`;

      const parts = [{ text: prompt }];
      if (articleText.trim()) {
        parts.push({ text: articleText });
      }
      if (imageBase64) {
        parts.push({
          inlineData: {
            mimeType: imageMimeType,
            data: imageBase64
          }
        });
      }

      const candidateModels = await getAvailableModels(cleanKey);
      let response = null;
      let lastErrorMsg = '';

      for (const modelName of candidateModels) {
        setExtractStatus(`${modelName} で単語・例文を抽出中...`);

        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${cleanKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: 'OBJECT',
                  properties: {
                    languageName: { type: 'STRING' },
                    languageCode: { type: 'STRING' },
                    words: {
                      type: 'ARRAY',
                      items: {
                        type: 'OBJECT',
                        properties: {
                          lemma: { type: 'STRING' },
                          surface: { type: 'STRING' },
                          pos: { type: 'STRING' },
                          meaningEn: { type: 'STRING' },
                          meaningJa: { type: 'STRING' },
                          exampleSentence: { type: 'STRING' }
                        },
                        required: [
                          'lemma',
                          'surface',
                          'pos',
                          'meaningEn',
                          'meaningJa',
                          'exampleSentence'
                        ]
                      }
                    }
                  },
                  required: ['languageName', 'languageCode', 'words']
                }
              }
            })
          }
        );

        if (response.ok) break;

        const errData = await response.json().catch(() => ({}));
        lastErrorMsg = errData.error?.message || `API Error (${response.status})`;

        if (
          response.status === 401 ||
          response.status === 403 ||
          lastErrorMsg.toLowerCase().includes('api key')
        ) {
          throw new Error(lastErrorMsg);
        }

        continue;
      }

      if (!response || !response.ok) {
        throw new Error(
          lastErrorMsg || '現在AIサーバーが混雑しています。10秒ほど待ってからもう一度お試しください。'
        );
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('AIから有効な応答が得られませんでした。');

      const cleanedJson = rawText.replace(/^```json\s*|\s*```$/g, '').trim();
      const parsed = JSON.parse(cleanedJson);
      const langCode = parsed.languageCode || 'sv-SE';
      const langName = parsed.languageName || '検出された言語';

      const existingLangData = vocabStore[langCode] || {
        name: langName,
        code: langCode,
        words: {}
      };

      const newWords = (parsed.words || []).filter((w) => {
        const key = w.lemma.toLowerCase().trim();
        return !existingLangData.words[key];
      });

      if (!vocabStore[langCode]) {
        setVocabStore((prev) => ({
          ...prev,
          [langCode]: existingLangData
        }));
      }

      setSelectedLang(langCode);
      setTriageLang({ code: langCode, name: langName });
      setTriageQueue(newWords);
      setActiveTab('triage');
    } catch (err) {
      setExtractError(`抽出エラー: ${err.message}`);
    } finally {
      setIsExtracting(false);
      setExtractStatus('');
    }
  };

  const handleTriageDecision = (decision) => {
    if (triageQueue.length === 0 || !triageLang) return;
    const current = triageQueue[0];
    const key = current.lemma.toLowerCase().trim();

    setVocabStore((prev) => {
      const langData = prev[triageLang.code] || {
        name: triageLang.name,
        code: triageLang.code,
        words: {}
      };
      return {
        ...prev,
        [triageLang.code]: {
          ...langData,
          words: {
            ...langData.words,
            [key]: {
              ...current,
              lemma: key,
              status: decision,
              streak: decision === 'known' ? 3 : 0,
              nextReview: Date.now(),
              addedAt: Date.now()
            }
          }
        }
      };
    });

    setSwipeOffset(0);
    setTriageQueue((prev) => prev.slice(1));
  };

  const onPointerDown = (e) => {
    setIsDragging(true);
    dragStartX.current = e.clientX;
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    setSwipeOffset(e.clientX - dragStartX.current);
  };

  const onPointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (swipeOffset > 95) {
      handleTriageDecision('known');
    } else if (swipeOffset < -95) {
      handleTriageDecision('learning');
    } else {
      setSwipeOffset(0);
    }
  };

  useEffect(() => {
    if (!selectedLang || !vocabStore[selectedLang]) {
      setStudyQueue([]);
      return;
    }
    const allWords = Object.values(vocabStore[selectedLang].words || {});
    const learningWords = allWords.filter((w) => w.status === 'learning');
    const now = Date.now();
    const filtered =
      studyMode === 'due'
        ? learningWords.filter((w) => (w.nextReview || 0) <= now)
        : learningWords;

    setStudyQueue(filtered);
    setIsFlipped(false);
  }, [selectedLang, studyMode, activeTab]);

  const handleFlashcardAnswer = (knewIt) => {
    if (studyQueue.length === 0 || !selectedLang) return;
    const current = studyQueue[0];
    const key = current.lemma;

    if (knewIt) {
      const nextStreak = (current.streak || 0) + 1;
      const graduated = nextStreak >= 3;
      const intervalDays = nextStreak === 1 ? 1 : nextStreak === 2 ? 3 : 7;

      setVocabStore((prev) => {
        const langObj = prev[selectedLang];
        return {
          ...prev,
          [selectedLang]: {
            ...langObj,
            words: {
              ...langObj.words,
              [key]: {
                ...current,
                streak: nextStreak,
                status: graduated ? 'known' : 'learning',
                nextReview: Date.now() + intervalDays * 24 * 60 * 60 * 1000
              }
            }
          }
        };
      });

      setSessionStats((s) => ({
        reviewed: s.reviewed + 1,
        graduated: s.graduated + (graduated ? 1 : 0)
      }));
      setStudyQueue((prev) => prev.slice(1));
    } else {
      setVocabStore((prev) => {
        const langObj = prev[selectedLang];
        return {
          ...prev,
          [selectedLang]: {
            ...langObj,
            words: {
              ...langObj.words,
              [key]: {
                ...current,
                streak: 0,
                nextReview: Date.now()
              }
            }
          }
        };
      });

      setSessionStats((s) => ({ ...s, reviewed: s.reviewed + 1 }));
      setStudyQueue((prev) => {
        const [first, ...rest] = prev;
        return [...rest, { ...first, streak: 0 }];
      });
    }

    setIsFlipped(false);
  };

  const handleBulkImport = () => {
    if (!bulkText.trim()) return;
    const targetLang = selectedLang || 'sv-SE';
    const langName = vocabStore[targetLang]?.name || 'スウェーデン語';

    const items = bulkText
      .split(/[\n,、]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    setVocabStore((prev) => {
      const langObj = prev[targetLang] || {
        name: langName,
        code: targetLang,
        words: {}
      };
      const updatedWords = { ...langObj.words };

      items.forEach((line) => {
        const parts = line.split(/[:：\t-]+/).map((s) => s.trim());
        const rawWord = parts[0];
        const key = rawWord?.toLowerCase();
        if (!key) return;
        updatedWords[key] = {
          lemma: key,
          surface: rawWord,
          pos: '単語',
          meaningEn: parts[1] || '',
          meaningJa: parts[2] || parts[1] || '（一括登録）',
          exampleSentence: '',
          status: bulkStatus,
          streak: bulkStatus === 'known' ? 3 : 0,
          nextReview: Date.now(),
          addedAt: Date.now()
        };
      });

      return {
        ...prev,
        [targetLang]: {
          ...langObj,
          words: updatedWords
        }
      };
    });

    setSelectedLang(targetLang);
    setBulkText('');
    setShowBulkModal(false);
  };

  const toggleWordStatus = (langCode, lemma) => {
    setVocabStore((prev) => {
      const langObj = prev[langCode];
      const w = langObj.words[lemma];
      const nextStatus = w.status === 'known' ? 'learning' : 'known';
      return {
        ...prev,
        [langCode]: {
          ...langObj,
          words: {
            ...langObj.words,
            [lemma]: {
              ...w,
              status: nextStatus,
              streak: nextStatus === 'known' ? 3 : 0,
              nextReview: Date.now()
            }
          }
        }
      };
    });
  };

  const deleteWord = (langCode, lemma) => {
    setVocabStore((prev) => {
      const langObj = prev[langCode];
      const copy = { ...langObj.words };
      delete copy[lemma];
      return {
        ...prev,
        [langCode]: {
          ...langObj,
          words: copy
        }
      };
    });
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(vocabStore, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linder-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        setVocabStore(parsed);
        const langs = Object.keys(parsed);
        if (langs.length > 0) setSelectedLang(langs[0]);
        alert('バックアップを復元しました！');
      } catch {
        alert('JSONファイルの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
  };

  const renderMeaning = (w) => {
    const en = w.meaningEn || '';
    const ja = w.meaningJa || w.meaning || '';
    if (en && ja && en !== ja) {
      return { en, ja };
    }
    return { en: '', ja: ja || en };
  };

  const languages = Object.values(vocabStore);
  const currentLangObj = vocabStore[selectedLang];
  const currentWordsList = currentLangObj
    ? Object.values(currentLangObj.words || {})
    : [];
  const knownCount = currentWordsList.filter((w) => w.status === 'known').length;
  const learningCount = currentWordsList.filter((w) => w.status === 'learning').length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col max-w-xl mx-auto shadow-sm border-x border-slate-200">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center text-white font-black text-lg shadow-sm">
            L
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight leading-none text-slate-900">
              Linder
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5">
              リーディング特化型スワイプ単語帳
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {languages.length > 0 && (
            <select
              value={selectedLang}
              onChange={(e) => setSelectedLang(e.target.value)}
              className="text-xs font-semibold bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700"
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-lg border transition ${
              apiKey
                ? 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                : 'bg-amber-50 border-amber-300 text-amber-600 animate-pulse'
            }`}
            title="APIキー設定"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="bg-slate-900 text-white p-4 border-b border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-400">
              <Key className="w-4 h-4" />
              <span>Gemini APIキー設定（ブラウザ内にのみ保存）</span>
            </div>
            <button
              onClick={() => setShowSettings(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              閉じる
            </button>
          </div>
          <p className="text-xs text-slate-300 mb-2 leading-relaxed">
            Google AI Studio で取得した無料APIキーを入力すると、記事のOCR・言語推測・原形抽出が動作します。
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => handleSaveApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
            />
            <button
              onClick={() => setShowSettings(false)}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg"
            >
              保存
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 p-4 pb-24 overflow-y-auto">
        {activeTab === 'import' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-sm flex items-center gap-1.5 text-slate-800">
                  <FileText className="w-4 h-4 text-rose-500" />
                  記事を取り込む
                </h2>
                <button
                  onClick={() => {
                    setArticleText(SAMPLE_ARTICLE);
                    setImagePreview(null);
                    setImageBase64(null);
                  }}
                  className="text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded-lg transition"
                >
                  サンプル記事 (8 Sidor)
                </button>
              </div>

              <textarea
                rows={7}
                value={articleText}
                onChange={(e) => setArticleText(e.target.value)}
                placeholder="ここに読みたい外国語の記事を貼り付けてください..."
                className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 leading-relaxed"
              />

              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageChange}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2.5 px-3 rounded-xl border border-dashed border-slate-300 hover:border-rose-400 bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-2 transition"
                >
                  <Camera className="w-4 h-4 text-rose-500" />
                  {imagePreview ? '写真を変更する' : '本や新聞の写真を撮る / 画像選択'}
                </button>
                {imagePreview && (
                  <button
                    onClick={() => {
                      setImagePreview(null);
                      setImageBase64(null);
                    }}
                    className="p-2.5 rounded-xl bg-slate-100 text-slate-500 hover:text-rose-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {imagePreview && (
                <div className="rounded-xl overflow-hidden border border-slate-200 max-h-48 flex justify-center bg-slate-100">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="object-contain max-h-48"
                  />
                </div>
              )}

              {extractError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{extractError}</span>
                </div>
              )}

              <button
                onClick={handleExtractWords}
                disabled={isExtracting}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white font-bold text-sm shadow-md flex items-center justify-center gap-2 disabled:opacity-50 transition"
              >
                <Sparkles className="w-4 h-4" />
                {isExtracting
                  ? extractStatus || 'AIが言語判定・未知語を抽出中...'
                  : 'AIで未判定の単語を抽出する'}
              </button>
            </div>

            <div className="bg-slate-100/80 rounded-2xl p-4 text-xs text-slate-600 space-y-1.5">
              <p className="font-bold text-slate-700">Linder の学習フロー</p>
              <p>1. 記事を貼り付け（または撮影）してAI抽出を実行</p>
              <p>2. すでに「知ってる」「学習中」の単語は自動で除外</p>
              <p>3. 初見の単語だけを左右スワイプで高速仕分け</p>
              <p>4. 「知らない」に入れた単語は英語＋日本語訳＆記事例文つきで復習</p>
            </div>
          </div>
        )}

        {activeTab === 'triage' && (
          <div className="flex flex-col items-center justify-center min-h-[65vh]">
            {triageQueue.length > 0 ? (
              <div className="w-full space-y-5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500 px-1">
                  <span className="flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5 text-rose-500" />
                    {triageLang?.name}
                  </span>
                  <span>残り {triageQueue.length} 語</span>
                </div>

                <div
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  style={{
                    transform: `translateX(${swipeOffset}px) rotate(${swipeOffset * 0.04}deg)`,
                    transition: isDragging ? 'none' : 'transform 0.2s ease-out'
                  }}
                  className="bg-white rounded-3xl p-6 border-2 border-slate-200 shadow-lg select-none cursor-grab active:cursor-grabbing relative overflow-hidden"
                >
                  {swipeOffset > 35 && (
                    <div className="absolute top-4 left-4 border-2 border-emerald-500 text-emerald-600 font-black px-3 py-1 rounded-lg text-sm rotate-[-12deg] bg-emerald-50/90">
                      知ってる！
                    </div>
                  )}
                  {swipeOffset < -35 && (
                    <div className="absolute top-4 right-4 border-2 border-rose-500 text-rose-600 font-black px-3 py-1 rounded-lg text-sm rotate-[12deg] bg-rose-50/90">
                      知らない (学習へ)
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                      {triageQueue[0].pos}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        speakWord(triageQueue[0].lemma, triageLang?.code);
                      }}
                      className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="text-center my-6">
                    <h3 className="text-4xl font-black text-slate-900 tracking-tight">
                      {triageQueue[0].lemma}
                    </h3>
                    {triageQueue[0].surface &&
                      triageQueue[0].surface.toLowerCase() !== triageQueue[0].lemma && (
                        <p className="text-xs text-slate-400 mt-1">
                          記事内の形: {triageQueue[0].surface}
                        </p>
                      )}
                  </div>

                  {triageQueue[0].exampleSentence && (
                    <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 text-xs text-slate-600 leading-relaxed flex items-start gap-2">
                      <Quote className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>{triageQueue[0].exampleSentence}</span>
                    </div>
                  )}

                  <p className="text-[11px] text-center text-slate-400 mt-5">
                    ← 左スワイプで「知らない」 / 右スワイプで「知ってる」 →
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleTriageDecision('learning')}
                    className="py-4 rounded-2xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-sm flex items-center justify-center gap-2 transition"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    知らない (カード化)
                  </button>
                  <button
                    onClick={() => handleTriageDecision('known')}
                    className="py-4 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold text-sm flex items-center justify-center gap-2 transition"
                  >
                    知ってる (除外)
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-4 bg-white p-8 rounded-3xl border border-slate-200 w-full">
                <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="font-bold text-lg text-slate-800">
                  仕分け待ちの単語はありません
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  新しい記事を取り込むか、フラッシュカードで未知語を学習しましょう。
                </p>
                <div className="flex gap-2 justify-center pt-2">
                  <button
                    onClick={() => setActiveTab('import')}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
                  >
                    記事を取り込む
                  </button>
                  <button
                    onClick={() => setActiveTab('study')}
                    className="px-4 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-xs font-bold text-white"
                  >
                    カード学習へ
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'study' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-white p-2.5 rounded-2xl border border-slate-200">
              <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setStudyMode('due')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    studyMode === 'due'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  今日の復習分
                </button>
                <button
                  onClick={() => setStudyMode('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    studyMode === 'all'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  全学習中 ({learningCount})
                </button>
              </div>
              <div className="text-xs font-semibold text-slate-500 pr-2">
                卒業済: <span className="text-emerald-600 font-bold">{knownCount}</span>語
              </div>
            </div>

            {studyQueue.length > 0 ? (
              <div className="space-y-4">
                <div
                  onClick={() => setIsFlipped(!isFlipped)}
                  className="bg-white rounded-3xl p-6 border-2 border-slate-200 shadow-md min-h-[340px] flex flex-col justify-between cursor-pointer select-none transition hover:border-rose-300"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {[0, 1, 2].map((idx) => (
                        <span
                          key={idx}
                          className={`w-2.5 h-2.5 rounded-full ${
                            idx < (studyQueue[0].streak || 0)
                              ? 'bg-amber-500'
                              : 'bg-slate-200'
                          }`}
                        />
                      ))}
                      <span className="text-xs font-bold text-slate-500 ml-1">
                        {studyQueue[0].streak || 0}/3
                      </span>
                      {(studyQueue[0].streak || 0) === 2 && (
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                          <Flame className="w-3 h-3" /> 次で卒業！
                        </span>
                      )}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        speakWord(studyQueue[0].lemma, selectedLang);
                      }}
                      className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700"
                      title="単語を発音"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="text-center my-6">
                    <span className="text-xs font-semibold text-slate-400">
                      {studyQueue[0].pos}
                    </span>
                    <h3 className="text-4xl font-black text-slate-900 mt-1">
                      {studyQueue[0].lemma}
                    </h3>
                    {studyQueue[0].surface &&
                      studyQueue[0].surface.toLowerCase() !== studyQueue[0].lemma && (
                        <p className="text-xs text-slate-400 mt-1">
                          記事内の形: {studyQueue[0].surface}
                        </p>
                      )}
                  </div>

                  {isFlipped ? (
                    <div className="pt-4 border-t border-slate-100 space-y-3">
                      <div className="text-center space-y-1">
                        {renderMeaning(studyQueue[0]).en && (
                          <p className="text-sm font-bold text-slate-700">
                            {renderMeaning(studyQueue[0]).en}
                          </p>
                        )}
                        <p className="text-xl font-extrabold text-rose-600">
                          {renderMeaning(studyQueue[0]).ja}
                        </p>
                      </div>

                      {(studyQueue[0].exampleSentence || studyQueue[0].context) && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="bg-slate-50 rounded-2xl p-3 border border-slate-200/80 flex items-start justify-between gap-2"
                        >
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              記事内の例文
                            </p>
                            <p className="text-xs text-slate-700 leading-relaxed">
                              {studyQueue[0].exampleSentence || studyQueue[0].context}
                            </p>
                          </div>
                          <button
                            onClick={() =>
                              speakWord(
                                studyQueue[0].exampleSentence || studyQueue[0].context,
                                selectedLang
                              )
                            }
                            className="p-1.5 rounded-full bg-white border border-slate-200 text-slate-600 hover:text-rose-600 shrink-0 mt-1"
                            title="例文を読み上げ"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-center text-xs text-slate-400">
                      タップして英語＋日本語訳と記事内の例文を表示
                    </p>
                  )}
                </div>

                {isFlipped ? (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleFlashcardAnswer(false)}
                      className="py-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4 text-rose-500" />
                      まだ怪しい (0/3へ)
                    </button>
                    <button
                      onClick={() => handleFlashcardAnswer(true)}
                      className="py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Check className="w-4 h-4" />
                      覚えた！
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsFlipped(true)}
                    className="w-full py-4 rounded-2xl bg-slate-900 text-white font-bold text-sm"
                  >
                    答えを見る
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center space-y-3">
                <p className="font-bold text-base text-slate-800">
                  {studyMode === 'due'
                    ? '今日の復習カードはすべて完了しました！'
                    : '学習中のカードがありません'}
                </p>
                <p className="text-xs text-slate-500">
                  今回のセッション: {sessionStats.reviewed}枚復習 /{' '}
                  {sessionStats.graduated}語が既知語へ卒業
                </p>
                {studyMode === 'due' && learningCount > 0 && (
                  <button
                    onClick={() => setStudyMode('all')}
                    className="mt-2 px-4 py-2.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold"
                  >
                    全学習中カード ({learningCount}枚) を続けて練習する
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'library' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setLibraryFilter('learning')}
                className={`p-3.5 rounded-2xl border text-left transition ${
                  libraryFilter === 'learning'
                    ? 'bg-rose-50 border-rose-300'
                    : 'bg-white border-slate-200'
                }`}
              >
                <p className="text-xs text-slate-500 font-semibold">学習中 (未知語)</p>
                <p className="text-2xl font-black text-rose-600 mt-0.5">
                  {learningCount}
                </p>
              </button>
              <button
                onClick={() => setLibraryFilter('known')}
                className={`p-3.5 rounded-2xl border text-left transition ${
                  libraryFilter === 'known'
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-white border-slate-200'
                }`}
              >
                <p className="text-xs text-slate-500 font-semibold">既知語 (除外済)</p>
                <p className="text-2xl font-black text-emerald-600 mt-0.5">
                  {knownCount}
                </p>
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowBulkModal(!showBulkModal)}
                className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
              >
                + 単語を一括登録
              </button>
              <button
                onClick={exportBackup}
                className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                バックアップ保存
              </button>
              <button
                onClick={() => backupInputRef.current?.click()}
                className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                復元
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept=".json"
                onChange={importBackup}
                className="hidden"
              />
            </div>

            {showBulkModal && (
              <div className="bg-white p-4 rounded-2xl border border-slate-300 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-800">
                    基本単語や既知語をまとめて登録
                  </p>
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1"
                  >
                    <option value="known">既知語として登録</option>
                    <option value="learning">学習中 (0/3) に登録</option>
                  </select>
                </div>
                <textarea
                  rows={4}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={`1行に1語ずつ入力（英語訳 : 日本語訳 の順も可）\n例:\noch : and : そして\natt : to : 〜すること\nspringa : run : 走る`}
                  className="w-full text-xs border border-slate-200 rounded-xl p-2.5"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowBulkModal(false)}
                    className="px-3 py-1.5 text-xs text-slate-500"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleBulkImport}
                    className="px-4 py-1.5 rounded-lg bg-rose-500 text-white text-xs font-bold"
                  >
                    登録する
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {currentWordsList
                .filter((w) => w.status === libraryFilter)
                .map((w) => {
                  const { en, ja } = renderMeaning(w);
                  const example = w.exampleSentence || w.context;
                  return (
                    <div
                      key={w.lemma}
                      className="bg-white p-3.5 rounded-2xl border border-slate-200 flex items-start justify-between gap-2"
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-base text-slate-900">
                            {w.lemma}
                          </span>
                          {w.status === 'learning' && (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              {w.streak || 0}/3
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600">
                          {en && <span className="font-semibold text-slate-800">{en} / </span>}
                          <span>{ja}</span>
                        </p>
                        {example && (
                          <p className="text-[11px] text-slate-400 italic leading-snug pt-0.5">
                            "{example}"
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => speakWord(w.lemma, selectedLang)}
                          className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleWordStatus(selectedLang, w.lemma)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700"
                        >
                          {w.status === 'learning' ? '既知へ' : '学習へ'}
                        </button>
                        <button
                          onClick={() => deleteWord(selectedLang, w.lemma)}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 max-w-xl mx-auto bg-white border-t border-slate-200 grid grid-cols-4 py-2 px-1 z-20">
        <button
          onClick={() => setActiveTab('import')}
          className={`flex flex-col items-center py-1 text-[11px] font-bold ${
            activeTab === 'import' ? 'text-rose-600' : 'text-slate-400'
          }`}
        >
          <BookOpen className="w-5 h-5 mb-0.5" />
          取り込み
        </button>
        <button
          onClick={() => setActiveTab('triage')}
          className={`flex flex-col items-center py-1 text-[11px] font-bold relative ${
            activeTab === 'triage' ? 'text-rose-600' : 'text-slate-400'
          }`}
        >
          <Layers className="w-5 h-5 mb-0.5" />
          仕分け
          {triageQueue.length > 0 && (
            <span className="absolute top-0.5 right-5 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center">
              {triageQueue.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('study')}
          className={`flex flex-col items-center py-1 text-[11px] font-bold ${
            activeTab === 'study' ? 'text-rose-600' : 'text-slate-400'
          }`}
        >
          <Sparkles className="w-5 h-5 mb-0.5" />
          カード学習
        </button>
        <button
          onClick={() => setActiveTab('library')}
          className={`flex flex-col items-center py-1 text-[11px] font-bold ${
            activeTab === 'library' ? 'text-rose-600' : 'text-slate-400'
          }`}
        >
          <Check className="w-5 h-5 mb-0.5" />
          単語帳
        </button>
      </nav>
    </div>
  );
}
