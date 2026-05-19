import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { QAPair, HistoryItem } from './types';
import { API_EXTRACT, API_QUERY, API_ASK_AI } from './constants';
import { UploadCloud, Search, Image as ImageIcon, Loader2, Sparkles, Database, Trash2, Clock, CheckCircle2, Settings, X, Edit3, Save, LogIn, LogOut, Scan, Camera } from 'lucide-react';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import stringSimilarity from 'string-similarity';
import imageCompression from 'browser-image-compression';
import { db, auth } from './firebase';
import { collection, onSnapshot, query, addDoc, serverTimestamp, deleteDoc, doc, updateDoc, writeBatch, where, setDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';

const HighlightMatch = ({ query, target }: { query: string, target: string }) => {
  return <span>{target}</span>;
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [knowledgeBase, setKnowledgeBase] = useState<QAPair[]>([]);
  const [alertDialog, setAlertDialog] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, isDestructive?: boolean, onConfirm: () => void} | null>(null);
  const [isGlobalArEnabled, setIsGlobalArEnabled] = useState(true);
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [newApiKey, setNewApiKey] = useState('');
  const [lastUsedAIInfo, setLastUsedAIInfo] = useState<{key: string, model: string} | null>(null);

  useEffect(() => {
    const unsubSettings = onSnapshot(doc(db, 'system_settings', 'global'), (docSnap) => {
      if (docSnap.exists()) {
         setIsGlobalArEnabled(docSnap.data().isArEnabled !== false);
      } else {
         setIsGlobalArEnabled(true);
      }
    });
    return () => unsubSettings();
  }, []);
  
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'knowledgeBase'), where('isPublic', '==', true));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: QAPair[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        items.push({
          id: docSnap.id,
          question: data.question || '',
          answer: data.answer || '',
          sourceDetail: data.sourceDetail || '',
          ownerId: data.ownerId || '',
        });
      });
      setKnowledgeBase(items);
    }, (error) => {
      console.error("Firestore read error:", error);
    });

    return () => unsubscribe();
  }, []);

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const stored = localStorage.getItem('history');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  
  const [queryText, setQueryText] = useState('');
  const [queryImage, setQueryImage] = useState<File | null>(null);
  const [queryImagePreview, setQueryImagePreview] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  
  const [currentAnswers, setCurrentAnswers] = useState<HistoryItem[]>([]);
  const [currentSearchFailed, setCurrentSearchFailed] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);

  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');

  useEffect(() => {
    if (isSettingsOpen && currentUser?.email === 'tuanminh9218@gmail.com') {
       fetch('/api/admin/keys')
         .then(res => res.json())
         .then(data => {
            if (data.keys) setApiKeys(data.keys);
         }).catch(err => console.error("Could not fetch API keys", err));
    }
  }, [isSettingsOpen, currentUser]);

  const addApiKey = async () => {
    if (!newApiKey.trim()) return;
    try {
      const res = await fetch('/api/admin/keys/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newApiKey.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setApiKeys(data.keys);
        setNewApiKey('');
      }
    } catch (e) {
      console.error(e);
      setAlertDialog("Lỗi khi thêm API Key");
    }
  };

  const deleteApiKey = async (suffix: string) => {
    try {
      const res = await fetch('/api/admin/keys/' + suffix, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setApiKeys(data.keys);
      }
    } catch (e) {
      console.error(e);
      setAlertDialog("Lỗi khi xóa API Key");
    }
  };

  const saveEdit = async (index: number) => {
    const item = knowledgeBase[index];
    if (!item || !item.id) return;
    if (currentUser?.email !== 'tuanminh9218@gmail.com') {
      setAlertDialog("Chỉ tài khoản quản lý mới có quyền sửa dữ liệu.");
      return;
    }
    try {
      const docRef = doc(db, 'knowledgeBase', item.id);
      await updateDoc(docRef, { question: editQuestion, answer: editAnswer });
      setEditingIndex(null);
    } catch (e: any) {
      setAlertDialog("Bạn không có quyền sửa.");
    }
  };
  
  const deleteItem = async (index: number) => {
    const item = knowledgeBase[index];
    if (!item || !item.id) return;
    if (currentUser?.email !== 'tuanminh9218@gmail.com') {
      setAlertDialog("Chỉ tài khoản quản lý mới có quyền xóa dữ liệu.");
      return;
    }
    try {
      const docRef = doc(db, 'knowledgeBase', item.id);
      await deleteDoc(docRef);
    } catch (e: any) {
      setAlertDialog("Bạn không có quyền xóa.");
    }
  };

  const deleteAll = async () => {
    if (currentUser?.email !== 'tuanminh9218@gmail.com') {
       setAlertDialog("Chỉ tài khoản quản lý mới có quyền xóa toàn bộ dữ liệu.");
       return;
    }
    setConfirmDialog({
      message: "Cảnh báo: Bạn có chắc chắn muốn xóa TẤT CẢ dữ liệu trong cơ sở dữ liệu không? Hành động này không thể hoàn tác.",
      isDestructive: true,
      onConfirm: async () => {
        try {
          for (let i = 0; i < knowledgeBase.length; i += 400) {
            const chunk = knowledgeBase.slice(i, i + 400);
            const batch = writeBatch(db);
            chunk.forEach(item => {
              if (item.id) {
                 const ref = doc(db, 'knowledgeBase', item.id);
                 batch.delete(ref);
              }
            });
            await batch.commit();
          }
        } catch (e: any) {
          setAlertDialog("Lỗi khi xóa: " + e.message);
        }
      }
    });
  };

  useEffect(() => {
    localStorage.setItem('history', JSON.stringify(history));
  }, [history]);

  // Preview Data State
  const [previewData, setPreviewData] = useState<QAPair[] | null>(null);

  // AR Mode State
  const [isCameraMode, setIsCameraMode] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [arAnswers, setArAnswers] = useState<{question: string, answer: string, confidence?: number}[]>([]);
  const isArSearchingRef = React.useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let scanInterval: NodeJS.Timeout | null = null;

    if (isCameraMode) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then((s) => {
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = s;
          }
          scanInterval = setInterval(() => {
            if (isArSearchingRef.current || !videoRef.current || !canvasRef.current) return;
            isArSearchingRef.current = true;
            captureAndSearchAR().finally(() => {
               isArSearchingRef.current = false;
            });
          }, 1500); 
        })
        .catch(err => {
          setAlertDialog("Không thể mở camera. Vui lòng cấp quyền: " + err.message);
          setIsCameraMode(false);
        });
    }

    return () => {
       if (stream) stream.getTracks().forEach(track => track.stop());
       if (scanInterval) clearInterval(scanInterval);
       setArAnswers([]);
    };
  }, [isCameraMode]); // Intentionally avoiding knowledgeBase in dependency to prevent camera restart

  const captureAndSearchAR = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;

    // Scale down canvas to max 800px width for faster processing
    const MAX_WIDTH = 800;
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > MAX_WIDTH) {
      height = Math.floor(height * (MAX_WIDTH / width));
      width = MAX_WIDTH;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.5));
    if (!blob) return;
    
    const file = new File([blob], "ar_capture.jpg", { type: "image/jpeg" });
    const formData = new FormData();
    formData.append('image', file);
    
    try {
      const res = await fetch(API_QUERY, { method: 'POST', body: formData });
      if (!res.ok) return;
      const text = await res.text();
      if (text.trim().toLowerCase().startsWith("<")) {
        console.warn("AR Search: Server returned HTML (có thể do lỗi Deploy dạng Static Site khiến Backend không hoạt động).");
        return;
      }
      
      const data = JSON.parse(text);
      if (data.usedKey && data.usedModel) {
        setLastUsedAIInfo({ key: data.usedKey, model: data.usedModel });
      }
      if (data.results && Array.isArray(data.results)) {
        const foundAnswers: any[] = [];
        for (const resItem of data.results) {
           if (knowledgeBase.length > 0 && resItem.extractedQuestion) {
             const questions = knowledgeBase.map((item: any) => item.question || "");
             const match = stringSimilarity.findBestMatch(resItem.extractedQuestion, questions);
             if (match.bestMatch.rating >= 0.8) {
                const matchedItem = knowledgeBase[match.bestMatchIndex];
                
                // Avoid pushing identical questions
                if (foundAnswers.some(a => a.question === matchedItem.question)) continue;
                
                let answerText = matchedItem.answer || "";
                if (!answerText.match(/^[A-D]\s*-/)) {
                  const letterMatch = answerText.match(/^([A-D])[\.\:]?\s*(.*)/i);
                  if (answerText.match(/^[A-D]\s*-/)) {
                      // Do nothing
                  } else if (letterMatch) {
                    answerText = `${letterMatch[1].toUpperCase()} - ${letterMatch[2]}`;
                  }
                }
                foundAnswers.push({
                  question: matchedItem.question, 
                  answer: answerText,
                  confidence: match.bestMatch.rating
                });
             }
           }
        }
        
        if (foundAnswers.length > 0) {
          setArAnswers(foundAnswers);
          
          setHistory(prev => {
             const last5Items = prev.slice(0, 5);
             const newHistoryItems = foundAnswers
               .filter(fa => !last5Items.some(p => p.question === fa.question))
               .map(fa => ({
                 id: uuidv4(),
                 timestamp: Date.now(),
                 question: fa.question,
                 answer: fa.answer,
                 source: 'kb' as const,
                 originalQuery: fa.question
               }));
               
             if (newHistoryItems.length === 0) return prev;
             return [...newHistoryItems, ...prev];
          });
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError('');

    let allPairs: QAPair[] = [];
    let lastQuestion = "";
    let loopCount = 0;
    const MAX_LOOPS = 10;

    try {
      while (loopCount < MAX_LOOPS) {
        const formData = new FormData();
        formData.append('file', file);
        if (lastQuestion) {
          formData.append('lastQuestion', lastQuestion);
        }

        const res = await fetch(API_EXTRACT, {
          method: 'POST',
          body: formData,
        });
        const text = await res.text();
        
        const isHtml = text.trim().toLowerCase().startsWith("<!doctype") || text.trim().toLowerCase().startsWith("<html");

        if (isHtml) {
          if (res.status === 413) {
             throw new Error(`File quá lớn hoặc vượt quá giới hạn xử lý của máy chủ. Vui lòng thử nén PDF hoặc chia nhỏ file.`);
          }
          if (res.status === 200) {
            throw new Error("Lỗi Deploy: Ứng dụng dường như được Deploy dưới dạng Static Site thay vì Web Service nên API Backend không hoạt động. Vui lòng deploy lên nền tảng hỗ trợ (Render/Cloud Run).");
          }
          throw new Error(`Máy chủ không thể xử lý dữ liệu (Lỗi ${res.status}). Vui lòng thử lại sau giây lát.`);
        }

        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error(res.ok ? `Dữ liệu không hợp lệ: ${text.substring(0, 100)}` : `Lỗi hệ thống: ${res.status} ${res.statusText} - ${text.substring(0, 100)}`);
        }
        
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to extract data');
        }

        if (data.usedKey && data.usedModel) {
          setLastUsedAIInfo({ key: data.usedKey, model: data.usedModel });
        }

        const newPairs: QAPair[] = data.data || [];
        if (newPairs.length === 0) {
          break; // Done
        }

        allPairs = [...allPairs, ...newPairs];
        // Hiển thị tạm thời cho người dùng biết đang tải thêm
        setPreviewData(allPairs);
        
        if (newPairs.length < 30) {
          break; // Ít câu trả về quá thì chắc đã hết
        }

        lastQuestion = newPairs[newPairs.length - 1].question;
        loopCount++;
      }

      if (allPairs.length > 0) {
        setPreviewData(allPairs);
      } else {
        setUploadError('Không tìm thấy cặp câu hỏi/đáp án nào trong file.');
      }
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
      // Reset file input
      e.target.value = '';
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const options = {
        maxSizeMB: 1, // Compress image to max 1MB
        maxWidthOrHeight: 1600,
        useWebWorker: false // Web workers can be flaky on mobile (especially iOS/WKWebView or PWA), preventing compression.
      };
      
      const compressedFile = await imageCompression(file, options);
      setQueryImage(compressedFile);
      setQueryImagePreview(URL.createObjectURL(compressedFile));
    } catch (error) {
      console.error('Error compressing image:', error);
      // Fallback to original
      setQueryImage(file);
      setQueryImagePreview(URL.createObjectURL(file));
    }
  };

  const clearImage = () => {
    setQueryImage(null);
    setQueryImagePreview(null);
  };

  const handleSearch = async () => {
    if (!queryText.trim() && !queryImage) return;
    if (isSearching) return;

    setIsSearching(true);
    setCurrentAnswers([]);
    setCurrentSearchFailed(false);
    setSearchError(null);

    const formData = new FormData();
    if (queryText.trim()) formData.append('queryText', queryText);
    if (queryImage) formData.append('image', queryImage);
    // knowledgeBase is NOT sent to server to avoid Request Payload Too Large errors

    try {
      const res = await fetch(API_QUERY, {
        method: 'POST',
        body: formData,
      });
      const text = await res.text();
      
      const isHtml = text.trim().toLowerCase().startsWith("<!doctype") || text.trim().toLowerCase().startsWith("<html");
      
      if (isHtml) {
        console.error("Server returned HTML instead of JSON:", text.substring(0, 500));
        if (res.status === 413) {
          throw new Error("Dữ liệu quá lớn (có thể do hình ảnh quá nét). Vui lòng thử chụp ảnh lại hoặc giảm kích thước ảnh.");
        }
        if (res.status === 200) {
          throw new Error("Lỗi Deploy: Ứng dụng được Deploy dạng Static Site (chỉ có Frontend) thay vì Web Service (Full-stack). Backend Server API không hoạt động. Vui lòng deploy lại dạng Web Service.");
        }
        throw new Error(`Máy chủ gặp sự cố (Lỗi ${res.status}). Vui lòng thử lại sau giây lát.`);
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(res.ok ? `Dữ liệu không hợp lệ: ${text.substring(0, 100)}` : `Lỗi hệ thống: ${res.status} ${res.statusText} - ${text.substring(0, 100)}`);
      }

      if (!res.ok) {
        throw new Error(data?.error || 'Search failed');
      }

      if (data.usedKey && data.usedModel) {
        setLastUsedAIInfo({ key: data.usedKey, model: data.usedModel });
      }

      if (data.results && Array.isArray(data.results)) {
        // LOCAL STRING SIMILARITY -> Prevents huge payloads to server
        const localResults = data.results.map((resItem: any) => {
          let updatedResItem = { ...resItem };
          if (knowledgeBase.length > 0 && updatedResItem.extractedQuestion) {
            const questions = knowledgeBase.map((item: any) => item.question || "");
            const match = stringSimilarity.findBestMatch(updatedResItem.extractedQuestion, questions);
            const bestMatch = match.bestMatch;

            if (bestMatch.rating >= 0.8) {
              const matchedItem = knowledgeBase[match.bestMatchIndex];
              updatedResItem.foundInKb = true;
              
              let answerText = matchedItem.answer || "";
              if (!answerText.match(/^[A-D]\s*-/)) {
                 const letterMatch = answerText.match(/^([A-D])[\.\:]?\s*(.*)/i);
                 if (letterMatch) {
                   answerText = `${letterMatch[1].toUpperCase()} - ${letterMatch[2]}`;
                 }
              }
              
              updatedResItem.answer = answerText;
              updatedResItem.matchedQuestionFromKb = matchedItem.question;
              updatedResItem.sourceDetail = matchedItem.sourceDetail || "";
            }
          }
          return updatedResItem;
        });

        let hasFoundAtLeastOne = false;
        let newItems: HistoryItem[] = [];
        let duplicateCount = 0;
        let allProcessedItems: HistoryItem[] = [];

        for (const resItem of localResults) {
          if (resItem.foundInKb && resItem.answer) {
            hasFoundAtLeastOne = true;
            const questionText = resItem.extractedQuestion || queryText;
            const isDuplicate = history.some(item => item.question.toLowerCase() === questionText.toLowerCase()) || 
                                newItems.some(item => item.question.toLowerCase() === questionText.toLowerCase());

            const newItem: HistoryItem = {
              id: uuidv4(),
              timestamp: Date.now(),
              question: questionText,
              matchedQuestion: resItem.matchedQuestionFromKb,
              originalQuery: questionText,
              answer: resItem.answer,
              source: 'kb',
              imageUrl: undefined, // "không kèm theo hình ảnh đã tải lên"
              sourceDetail: resItem.sourceDetail
            };

            allProcessedItems.push(newItem);

            if (isDuplicate) {
              duplicateCount++;
            } else {
              newItems.push(newItem);
            }
          }
        }

        if (hasFoundAtLeastOne) {
          if (duplicateCount > 0 && newItems.length === 0) {
            setDuplicateMessage(`Tất cả câu hỏi (${duplicateCount}) đã trùng trong lịch sử truy vấn.`);
            setTimeout(() => setDuplicateMessage(null), 3000);
          } else if (duplicateCount > 0) {
            setDuplicateMessage(`Đã trùng ${duplicateCount} câu hỏi trong lịch sử truy vấn.`);
            setTimeout(() => setDuplicateMessage(null), 3000);
          }

          setCurrentAnswers(allProcessedItems);
          if (newItems.length > 0) {
            setHistory(prev => [...newItems, ...prev]);
          }
          setQueryText('');
          clearImage();
        } else {
          setCurrentSearchFailed(true);
        }
      } else if (data.foundInKb && data.answer) {
        // Fallback for older response
        const questionText = data.extractedQuestion || queryText;
        const isDuplicate = history.some(item => item.question.toLowerCase() === questionText.toLowerCase());

        const newItem: HistoryItem = {
          id: uuidv4(),
          timestamp: Date.now(),
          question: questionText,
          matchedQuestion: data.matchedQuestionFromKb,
          originalQuery: questionText,
          answer: data.answer,
          source: 'kb',
          imageUrl: undefined,
          sourceDetail: data.sourceDetail
        };
        
        if (isDuplicate) {
          setDuplicateMessage(`Đã trùng với câu hỏi trong lịch sử truy vấn.`);
          setTimeout(() => setDuplicateMessage(null), 3000);
          setCurrentAnswers([newItem]);
        } else {
          setCurrentAnswers([newItem]);
          setHistory(prev => [newItem, ...prev]);
        }
        setQueryText('');
        clearImage();
      } else {
         // Proceed to suggest Ask AI
         setCurrentSearchFailed(true);
      }
    } catch(err: any) {
      console.error(err);
      if (err.message === "Failed to fetch") {
        setSearchError("Mất kết nối mạng hoặc ảnh quá lớn không thể tải lên. Vui lòng kiểm tra Wifi/3G hoặc tải ảnh dung lượng thấp hơn.");
      } else {
        setSearchError(err.message);
      }
      setCurrentSearchFailed(true);
    } finally {
      setIsSearching(false);
    }
  };

  const askAI = async () => {
    setIsSearching(true);
    setCurrentAnswers([]);
    setSearchError(null);
    
    // We already have queryText and queryImage
    const formData = new FormData();
    if (queryText.trim()) formData.append('queryText', queryText);
    if (queryImage) formData.append('image', queryImage);

    try {
      const res = await fetch(API_ASK_AI, {
        method: 'POST',
        body: formData,
      });
      const text = await res.text();
      
      const isHtml = text.trim().toLowerCase().startsWith("<!doctype") || text.trim().toLowerCase().startsWith("<html");
      
      if (isHtml) {
        if (res.status === 413) {
          throw new Error("Dữ liệu quá lớn (có thể do hình ảnh quá nét). Vui lòng thử chụp ảnh lại hoặc giảm kích thước ảnh.");
        }
        if (res.status === 200) {
          throw new Error("Lỗi Deploy: Ứng dụng được Deploy dạng Static Site (chỉ có Frontend) thay vì Web Service (Full-stack). Backend Server API không hoạt động. Vui lòng deploy lại dạng Web Service.");
        }
        throw new Error(`Máy chủ AI bị gián đoạn (Lỗi ${res.status}). Vui lòng thử lại sau giây lát.`);
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(res.ok ? `Dữ liệu không hợp lệ: ${text.substring(0, 100)}` : `Lỗi hệ thống: ${res.status} ${res.statusText} - ${text.substring(0, 100)}`);
      }

      if (!res.ok) {
        throw new Error(data?.error || 'AI request failed');
      }

      if (data.usedKey && data.usedModel) {
        setLastUsedAIInfo({ key: data.usedKey, model: data.usedModel });
      }

      const extractedQuestionDisplay = currentSearchFailed ? queryText : (queryText || "Image Query");
      const isDuplicate = history.some(item => item.question.toLowerCase() === extractedQuestionDisplay.toLowerCase());

      const newItem: HistoryItem = {
        id: uuidv4(),
        timestamp: Date.now(),
        question: extractedQuestionDisplay,
        answer: data.answer,
        source: 'ai',
        imageUrl: undefined
      };
      
      if (isDuplicate) {
        setDuplicateMessage(`Đã trùng với câu hỏi trong lịch sử truy vấn.`);
        setTimeout(() => setDuplicateMessage(null), 3000);
        setCurrentAnswers([newItem]);
      } else {
        setCurrentAnswers([newItem]);
        setHistory(prev => [newItem, ...prev]);
      }
      
      setCurrentSearchFailed(false);
      setQueryText('');
      clearImage();
    } catch(err: any) {
      console.error(err);
      if (err.message === "Failed to fetch") {
        setSearchError("Mất kết nối mạng. Vui lòng kiểm tra Wifi/3G và thử lại.");
      } else {
        setSearchError(err.message);
      }
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-200 font-sans p-3 md:p-6 lg:p-8 bg-gradient-to-br from-[#0F172A] to-[#1E293B]">
      <div className="max-w-7xl mx-auto flex flex-col h-full gap-4 md:gap-6">
        <header className="mb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white flex items-center gap-2 md:gap-3">
              <div className="w-8 h-8 md:w-10 md:h-10 bg-blue-600 rounded-xl flex items-center justify-center font-bold text-white text-lg md:text-xl shadow-lg">QA</div>
              Smart Q&A 
            </h1>
            <div className="flex items-center gap-2 mt-1 md:mt-2">
              <p className="text-slate-400 text-[10px] md:text-xs uppercase tracking-widest font-bold">Luyện thi đấu thầu</p>
              {lastUsedAIInfo && (() => {
                const activeIndex = apiKeys.findIndex(k => k.slice(-5) === lastUsedAIInfo.key.slice(-5)) + 1;
                const label = activeIndex > 0 ? `API-${activeIndex}` : 'API-ENV';
                return (
                  <div className="hidden sm:inline-flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/50 px-2 py-0.5 rounded text-[10px] text-slate-300">
                    <Sparkles className="w-3 h-3 text-emerald-400" />
                    {label}: ...{lastUsedAIInfo.key.slice(-5)} - {lastUsedAIInfo.model}
                  </div>
                );
              })()}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {currentUser ? (
              <button onClick={() => signOut(auth)} className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors text-slate-300 shadow-xl border border-slate-700 flex items-center gap-2 font-medium text-xs sm:text-sm" title="Đăng xuất">
                 <img src={currentUser.photoURL || ""} alt="Avatar" className="w-5 h-5 sm:w-6 sm:h-6 rounded-full" />
                 <span className="hidden sm:inline">Đăng xuất</span>
              </button>
            ) : (
              <button 
                onClick={() => {
                  const provider = new GoogleAuthProvider();
                  signInWithPopup(auth, provider).catch(e => setAlertDialog(e.message));
                }}
                className="px-3 py-1.5 sm:px-4 sm:py-2 bg-blue-600/20 text-blue-400 rounded-xl hover:bg-blue-600/30 transition-colors shadow-xl border border-blue-500/30 flex items-center gap-2 font-medium text-xs sm:text-sm"
              >
                <LogIn className="w-3 h-3 sm:w-4 sm:h-4" />
                Đăng nhập
              </button>
            )}
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 sm:p-3 bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors text-slate-300 shadow-xl border border-slate-700 flex items-center gap-2 font-medium" title="Quản lý dữ liệu">
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline text-sm">Quản lý Dữ liệu</span>
            </button>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 flex-1">
          
          {/* LEFT COLUMN: Main App Actions */}
          <div className="lg:col-span-8 flex flex-col gap-4 md:gap-6">
            
            {/* 1. QUERY INPUT BENTO */}
            <section className="bg-slate-800/40 rounded-3xl p-4 md:p-6 border border-slate-700/50 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-2 mb-4">
                <h2 className="text-xs md:text-sm font-bold uppercase tracking-widest text-slate-400">Tra cứu câu hỏi</h2>
              </div>
              <div className="flex flex-col gap-4">
                <textarea 
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  placeholder="Nhập câu hỏi của bạn tại đây..."
                  className="w-full bg-slate-900/50 border border-slate-700/50 rounded-2xl p-3 md:p-4 text-sm md:text-base text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[80px] md:min-h-[100px] placeholder-slate-500"
                />
                
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 md:gap-4">
                  <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto flex-wrap">
                    {isGlobalArEnabled && (
                      <button onClick={() => setIsCameraMode(true)} className="flex-1 sm:flex-none px-3 py-2 md:px-4 md:py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl flex items-center justify-center gap-2 text-xs md:text-sm font-bold transition-colors">
                         <Scan className="w-4 h-4 md:w-4 md:h-4" />
                         Quét AR
                      </button>
                    )}
                    <label className="cursor-pointer flex-1 justify-center sm:flex-none px-3 py-2 md:px-4 md:py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl flex items-center gap-2 text-xs md:text-sm font-bold transition-colors">
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment"
                        className="hidden" 
                        onChange={handleImageSelect}
                      />
                      <Camera className="w-4 h-4 md:w-4 md:h-4" />
                      Chụp ảnh
                    </label>
                    <label className="cursor-pointer flex-1 justify-center sm:flex-none px-3 py-2 md:px-4 md:py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl flex items-center gap-2 text-xs md:text-sm font-bold transition-colors">
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleImageSelect}
                      />
                      <ImageIcon className="w-4 h-4 md:w-4 md:h-4" />
                      Tải ảnh
                    </label>
                    {queryImagePreview && (
                      <div className="relative group rounded-xl overflow-hidden shadow-sm h-8 w-12 md:h-10 md:w-16 bg-slate-800 flex items-center justify-center border border-slate-600">
                         <img src={queryImagePreview} alt="Preview" className="w-full h-full object-cover opacity-80 group-hover:opacity-100" />
                         <button 
                           onClick={clearImage}
                           className="absolute inset-0 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                         >
                            <Trash2 className="w-3 h-3 md:w-4 md:h-4" />
                         </button>
                      </div>
                    )}
                  </div>
                  
                  <button 
                    onClick={handleSearch}
                    disabled={isSearching || (!queryText.trim() && !queryImage)}
                    className={cn(
                      "w-full sm:w-auto px-6 py-2 md:px-8 md:py-2.5 rounded-full flex items-center justify-center gap-2 text-sm md:text-base font-bold transition-all shadow-lg",
                      isSearching || (!queryText.trim() && !queryImage) 
                        ? "bg-slate-700 text-slate-500 cursor-not-allowed border border-slate-600" 
                        : "bg-white hover:bg-slate-200 text-slate-900 outline outline-2 outline-white/20"
                    )}
                  >
                     {isSearching ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : <Search className="w-4 h-4" />}
                     {isSearching ? 'Đang tìm...' : 'Tra cứu ngay'}
                  </button>
                </div>
              </div>
            </section>

            {/* 3. ANSWER DISPLAY BENTO */}
            {searchError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded-2xl p-4 flex items-center justify-between text-red-400">
                <span className="font-medium text-sm">{searchError}</span>
                <button onClick={() => setSearchError(null)} className="p-1 hover:bg-red-500/20 rounded-lg transition-colors"><X className="w-4 h-4" /></button>
              </div>
            )}
            
            <AnimatePresence mode="wait">
              {currentSearchFailed && !isSearching && (
                <motion.section 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="col-span-8 bg-indigo-900/30 rounded-3xl p-6 md:p-8 border border-indigo-500/30 flex flex-col justify-center items-center shadow-lg relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Sparkles className="w-24 h-24 md:w-32 md:h-32 text-indigo-400" />
                  </div>
                  <h2 className="text-[10px] md:text-sm font-bold uppercase tracking-widest text-indigo-400 mb-2">Chế độ mở rộng</h2>
                  <h3 className="text-lg md:text-xl font-semibold mb-2 text-white">Sử dụng Trí tuệ Nhân tạo</h3>
                   <p className="text-xs md:text-sm text-indigo-200/70 mb-6 max-w-md text-center">Câu hỏi này không có trong dữ liệu tải lên hoặc có thể không đủ độ chính xác (dưới 70%). AI sẽ hỗ trợ giải đáp dựa trên kiến thức mở rộng.</p>
                  
                  <button 
                     onClick={askAI}
                     className="px-6 py-3 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl font-bold text-sm shadow-md transition-colors relative z-10"
                  >
                    Kích hoạt AI Assistant
                  </button>
                </motion.section>
              )}

              {currentAnswers.length > 0 && (
                <div className="flex flex-col gap-4">
                  {currentAnswers.map((currentAnswer) => (
                    <motion.section 
                      key={currentAnswer.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "rounded-3xl p-5 pt-8 md:p-8 md:pt-10 flex flex-col shadow-2xl relative mt-4 sm:mt-0",
                        currentAnswer.source === 'kb' ? "bg-slate-800/80 border-2 border-emerald-500/50" : "bg-indigo-900/40 border-2 border-indigo-500/50"
                      )}
                    >
                      {currentAnswer.source === 'kb' ? (
                         <div className="absolute -top-3 left-6 md:left-8 px-3 py-0.5 md:px-4 md:py-1 bg-emerald-500 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-widest text-emerald-950 shadow-md">
                           KẾT QUẢ CHÍNH XÁC
                         </div>
                       ) : (
                         <div className="absolute -top-3 left-6 md:left-8 px-3 py-0.5 md:px-4 md:py-1 bg-indigo-500 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-widest text-white shadow-md">
                           TRẢ LỜI BỞI AI
                         </div>
                       )}

                       <div className="mb-4 md:mb-6 mt-2 md:mt-4">
                         <span className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider">
                           {currentAnswer.source === 'kb' && currentAnswer.matchedQuestion ? 'Câu hỏi tương đồng trong dữ liệu:' : 'Nội dung câu hỏi:'}
                         </span>
                         <p className="text-base md:text-lg mt-1 md:mt-2 font-medium text-slate-200">
                           {currentAnswer.source === 'kb' && currentAnswer.matchedQuestion && currentAnswer.originalQuery ? (
                             <HighlightMatch query={currentAnswer.originalQuery} target={currentAnswer.matchedQuestion} />
                           ) : (
                             currentAnswer.question
                           )}
                         </p>
                         {currentAnswer.imageUrl && (
                           <div className="mt-4 max-w-[200px] border border-slate-700/50 rounded-xl overflow-hidden shadow-md">
                             <img src={currentAnswer.imageUrl} alt="Query context" className="w-full h-auto opacity-90" />
                           </div>
                         )}
                       </div>

                       <div className="flex-1 bg-slate-900/60 rounded-2xl p-4 md:p-6 border border-slate-700/50">
                         <span className="text-[10px] md:text-xs font-bold text-red-500 uppercase flex items-center gap-2 mb-2 tracking-wider">
                           <span className="w-1.5 h-1.5 md:w-2 md:h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
                           Phương án trả lời:
                         </span>
                         <div className="mt-2 md:mt-4 text-lg md:text-2xl font-bold leading-tight">
                           <span className="text-red-400">
                             {currentAnswer.answer}
                           </span>
                         </div>
                       </div>

                       {currentAnswer.sourceDetail && (
                         <div className="mt-4 flex items-center gap-2 text-slate-500 text-xs font-medium bg-slate-800/40 p-3 rounded-xl border border-slate-700/50 w-fit">
                            <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2"/></svg>
                            Nguồn: {currentAnswer.sourceDetail}
                         </div>
                       )}
                    </motion.section>
                  ))}
                </div>
              )}
            </AnimatePresence>

          </div>

          {/* RIGHT COLUMN: History */}
          <aside className="lg:col-span-4 max-h-[500px] lg:max-h-[800px]">
             <div className="bg-[#1E293B] rounded-3xl p-4 md:p-6 border border-slate-700/50 shadow-xl h-full flex flex-col">
                <div className="flex items-center justify-between mb-2 md:mb-4">
                  <h3 className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Lịch sử truy vấn
                  </h3>
                  {history.length > 0 && (
                    <button 
                      onClick={() => {
                        setConfirmDialog({
                          message: "Bạn có chắc chắn muốn xóa tất cả lịch sử truy vấn không?",
                          isDestructive: true,
                          onConfirm: () => setHistory([])
                        });
                      }} 
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
                      title="Xóa lịch sử"
                    >
                      <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    </button>
                  )}
                </div>

                {duplicateMessage && (
                  <div className="mb-4 text-xs font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg animate-pulse">
                    {duplicateMessage}
                  </div>
                )}

                <div className="flex-1 overflow-y-auto pr-2 space-y-1.5 -mr-2">
                  {history.length === 0 ? (
                    <div className="text-center text-slate-500 py-10 text-sm font-medium">
                      Chưa có lịch sử truy vấn
                    </div>
                  ) : (
                    history.map(item => (
                      <div 
                        key={item.id} 
                        className={cn(
                          "p-2.5 rounded-xl cursor-pointer transition-colors border",
                          currentAnswers.some(ans => ans.id === item.id) 
                            ? "bg-slate-800/80 border-slate-600 shadow-md" 
                            : "hover:bg-slate-800/40 border-transparent hover:border-slate-700/30"
                        )}
                        onClick={() => {
                          setCurrentAnswers([item]);
                          setCurrentSearchFailed(false);
                        }}
                      >
                         <div className="flex items-center justify-between mb-1">
                           <div className="flex items-center gap-1.5">
                             {item.source === 'kb' ? (
                               <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"></span>
                             ) : (
                               <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.5)]"></span>
                             )}
                             <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                               {item.source === 'kb' ? 'Câu hỏi' : 'AI'}
                             </span>
                           </div>
                           <span className="text-[10px] text-slate-500 font-mono">
                             {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                           </span>
                         </div>
                         <p className="text-[13px] font-medium text-slate-200 line-clamp-2 leading-snug">
                           {item.question}
                         </p>
                         {item.answer && (
                           <p className="text-[11px] mt-1 font-medium text-slate-400 line-clamp-1">
                             <span className="font-bold text-red-500">Đáp án:</span> {item.answer.match(/^([A-D])/i) ? item.answer.match(/^([A-D])/i)![1].toUpperCase() : item.answer.split('-')[0].trim()}
                           </p>
                         )}
                      </div>
                    ))
                  )}
                </div>
             </div>
          </aside>

        </main>
      </div>

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-6xl max-h-[90vh] md:max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 md:p-6 border-b border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-800/80">
              <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-400 shrink-0" />
                Thiết lập Hệ thống
              </h2>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors self-end sm:self-auto"
              >
                <X className="w-4 h-4 md:w-5 md:h-5" />
              </button>
            </div>

            {/* Top Row: File upload + AR setting */}
            <div className="p-4 md:p-6 border-b border-slate-700 bg-slate-800/30 flex flex-col md:flex-row gap-4 items-stretch">
               {/* Upload Box */}
               <div className="flex-1">
                 <label className="relative flex cursor-pointer w-full group h-full">
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".pdf,.docx,.txt,image/*" 
                      onChange={handleFileUpload}
                      disabled={isUploading}
                    />
                    <div className="border border-dashed border-slate-600 rounded-xl p-4 text-center group-hover:border-blue-400 group-hover:bg-blue-900/20 transition-colors bg-slate-900/50 w-full flex items-center justify-center min-h-[80px]">
                      {isUploading ? (
                        <div className="flex flex-col items-center justify-center text-blue-400">
                           <Loader2 className="w-5 h-5 animate-spin mb-1" />
                           <span className="text-xs font-bold">Đang xử lý tài liệu...</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center text-slate-400 group-hover:text-blue-400 transition-colors">
                          <UploadCloud className="w-5 h-5 mb-1" />
                          <span className="text-xs font-bold">Tải lên file (PDF, DOCX, TXT, Ảnh)</span>
                        </div>
                      )}
                    </div>
                 </label>
                 {uploadError && <p className="text-red-400 text-xs font-medium mt-1">{uploadError}</p>}
               </div>
               
               {/* AR Settings */}
               {currentUser?.email === 'tuanminh9218@gmail.com' && (
                 <div className="w-full md:w-80 flex flex-col justify-center p-4 bg-slate-900/60 rounded-xl border border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                       <h3 className="text-sm font-bold text-slate-200">Chức năng Quét AR</h3>
                       <label className="flex items-center cursor-pointer group">
                         <div className={cn(
                           "w-11 h-6 flex items-center rounded-full p-1 transition-colors",
                           isGlobalArEnabled ? "bg-emerald-500" : "bg-slate-700 group-hover:bg-slate-600"
                         )}>
                           <div className={cn(
                             "bg-white w-4 h-4 rounded-full shadow-md transform transition-transform",
                             isGlobalArEnabled ? "translate-x-5" : "translate-x-0"
                           )} />
                         </div>
                         <input 
                           type="checkbox" 
                           className="hidden" 
                           checked={isGlobalArEnabled} 
                           onChange={async (e) => {
                              const newVal = e.target.checked;
                              setIsGlobalArEnabled(newVal); // Optimistic update
                              try {
                                await setDoc(doc(db, 'system_settings', 'global'), { isArEnabled: newVal }, { merge: true });
                              } catch (error) {
                                console.error(error);
                                setAlertDialog("Lỗi khi lưu cài đặt.");
                                setIsGlobalArEnabled(!newVal); // Revert on failure
                              }
                           }} 
                         />
                       </label>
                    </div>
                    <p className="text-xs text-slate-400">Bật/tắt tính năng quét AR trên toàn hệ thống.</p>
                 </div>
               )}
            </div>

            {/* Bottom Row: 2 Columns */}
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-slate-900/50">
               {/* Column 1: API Keys */}
               {currentUser?.email === 'tuanminh9218@gmail.com' && (
                 <div className="w-full md:w-[380px] lg:w-[420px] border-b md:border-b-0 md:border-r border-slate-700 flex flex-col bg-slate-900/60 overflow-y-auto">
                    <div className="p-4 md:p-6 pb-2">
                      <h3 className="text-sm font-bold text-slate-200">Quản lý Gemini API Keys</h3>
                      <p className="text-xs text-slate-400 mt-1 mb-3">Thêm các API Key để dự phòng khi hết Quota (Lỗi 429). Hệ thống tự động chuyển đổi Key và Model.</p>
                    </div>
                    
                    <div className="px-4 md:px-6">
                      {lastUsedAIInfo && (() => {
                        const activeIndex = apiKeys.findIndex(k => k.slice(-5) === lastUsedAIInfo.key.slice(-5)) + 1;
                        const label = activeIndex > 0 ? `API-${activeIndex}` : 'API-ENV';
                        return (
                          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 rounded-lg shadow-sm mb-4">
                            <Sparkles className="w-4 h-4 text-emerald-400" />
                            <span className="text-xs text-emerald-300">
                              Đang dùng {label}: <strong className="font-mono text-emerald-200 text-sm bg-emerald-900/30 px-1 py-0.5 rounded">...{lastUsedAIInfo.key.slice(-5)}</strong> <br className="sm:hidden" /><span className="hidden sm:inline"> | </span>Model: <span className="font-semibold text-emerald-100">{lastUsedAIInfo.model}</span>
                            </span>
                          </div>
                        );
                      })()}

                      <div className="flex gap-2 mb-4">
                        <input 
                          type="text" 
                          value={newApiKey}
                          onChange={(e) => setNewApiKey(e.target.value)}
                          placeholder="Nhập API Key mới..."
                          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button 
                          onClick={addApiKey}
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
                        >
                          Thêm
                        </button>
                      </div>

                      {apiKeys.length > 0 && (
                        <div className="flex flex-col mt-2 pb-4 flex-1 min-h-0 overflow-hidden">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Danh sách API Keys đã lưu</p>
                            <span className="text-[10px] bg-slate-800 text-slate-300 font-bold px-2 py-1 rounded-md border border-slate-700 uppercase tracking-wider">
                              Tổng số: {apiKeys.length}
                            </span>
                          </div>
                          <div className="flex flex-col gap-2 overflow-y-auto pr-1 flex-1 min-h-[100px] max-h-[300px]">
                            {[...apiKeys].reverse().map((keyStr, idx) => {
                               const originalIndex = apiKeys.length - idx;
                               const isActive = lastUsedAIInfo?.key.slice(-5) === keyStr.slice(-5);
                               return (
                                 <div key={keyStr} className={cn(
                                   "flex items-center justify-between p-2 rounded-lg border transition-colors flex-shrink-0",
                                   isActive 
                                     ? "bg-emerald-900/20 border-emerald-500/30 shadow-sm" 
                                     : "bg-slate-800/80 border-slate-700"
                                 )}>
                                   <div className="flex items-center gap-2">
                                     {isActive ? (
                                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                     ) : (
                                        <div className="w-2 h-2 rounded-full bg-transparent" />
                                     )}
                                     <span className={cn(
                                       "text-sm font-mono tracking-wider",
                                       isActive ? "text-emerald-300 font-bold" : "text-slate-300"
                                     )}>
                                       API-{originalIndex}: ...{keyStr.slice(-5)}
                                     </span>
                                   </div>
                                   <button 
                                     onClick={() => deleteApiKey(keyStr.slice(-5))}
                                     className="p-1.5 text-red-500 hover:bg-red-500/20 rounded-md transition-colors"
                                     title="Xóa Key này"
                                   >
                                      <Trash2 className="w-4 h-4" />
                                   </button>
                                 </div>
                               );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                 </div>
               )}

               {/* Column 2: Knowledge Base */}
               <div className="flex-1 flex flex-col overflow-hidden bg-slate-900">
                 <div className="p-4 md:p-6 border-b border-slate-800 flex justify-between items-center bg-slate-800/30">
                    <h3 className="text-sm font-bold text-slate-200">Dữ liệu nguồn (Knowledge Base)</h3>
                    <div className="text-[10px] font-black bg-slate-700/50 text-blue-400 px-3 py-1.5 rounded-full uppercase tracking-wider border border-slate-600/50">
                      {knowledgeBase.length} câu đã nạp
                    </div>
                 </div>
                 <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3 md:space-y-4">
                   {knowledgeBase.length === 0 ? (
                     <div className="text-center text-slate-500 py-10 font-medium text-sm md:text-base">Chưa có dữ liệu nào.</div>
                   ) : (
                     knowledgeBase.map((item, idx) => (
                       <div key={idx} className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 md:p-4">
                         {editingIndex === idx ? (
                           <div className="space-y-3">
                             <textarea 
                               value={editQuestion}
                               onChange={(e) => setEditQuestion(e.target.value)}
                               className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-slate-200 text-xs md:text-sm focus:outline-none focus:border-blue-500"
                               rows={2}
                               placeholder="Câu hỏi"
                             />
                             <textarea 
                               value={editAnswer}
                               onChange={(e) => setEditAnswer(e.target.value)}
                               className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-slate-200 text-xs md:text-sm focus:outline-none focus:border-blue-500"
                               rows={2}
                               placeholder="Đáp án"
                             />
                             <div className="flex justify-end gap-2">
                                <button onClick={() => setEditingIndex(null)} className="px-3 py-1.5 text-xs md:text-sm font-medium text-slate-300 hover:bg-slate-700 rounded-lg transition-colors">Hủy</button>
                                <button onClick={() => saveEdit(idx)} className="px-3 py-1.5 text-xs md:text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-1"><Save className="w-3 h-3 md:w-4 md:h-4"/> Lưu</button>
                             </div>
                           </div>
                         ) : (
                           <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 md:gap-4 relative">
                             <div className="space-y-2 flex-1 pr-16 sm:pr-0">
                               <p className="text-xs md:text-sm font-medium text-slate-200">
                                 <span className="inline-block bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[10px] md:text-xs font-bold mr-2">Câu {idx + 1}</span>
                                 <span className="text-slate-500 font-bold uppercase text-[10px] md:text-xs mr-1">Q:</span> 
                                 {item.question}
                               </p>
                               <p className="text-xs md:text-sm text-red-400 font-bold">
                                 <span className="ml-[48px] md:ml-[52px] text-slate-500 font-bold uppercase text-[10px] md:text-xs mr-1">A:</span> 
                                 {item.answer}
                               </p>
                               {item.sourceDetail && <p className="text-[9px] md:text-[10px] text-slate-500 font-mono ml-[48px] md:ml-[52px]">Nguồn: {item.sourceDetail}</p>}
                             </div>
                             <div className="flex gap-1 absolute top-0 right-0 sm:relative sm:top-auto sm:right-auto">
                               <button onClick={() => { setEditingIndex(idx); setEditQuestion(item.question); setEditAnswer(item.answer); }} className="p-1.5 md:p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded-lg transition-colors"><Edit3 className="w-3 h-3 md:w-4 md:h-4"/></button>
                               <button onClick={() => deleteItem(idx)} className="p-1.5 md:p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-colors"><Trash2 className="w-3 h-3 md:w-4 md:h-4"/></button>
                             </div>
                           </div>
                         )}
                       </div>
                     ))
                   )}
                 </div>
                 {knowledgeBase.length > 0 && (
                   <div className="p-4 border-t border-slate-700 bg-slate-800/30 flex justify-end gap-3">
                     <button 
                       onClick={deleteAll}
                       className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors"
                     >
                       <Trash2 className="w-4 h-4" /> Xóa tất cả dữ liệu
                     </button>
                   </div>
                 )}
               </div>
            </div>
          </div>
        </div>
      )}

      {previewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-5xl max-h-[90vh] md:max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-4 md:p-6 border-b border-slate-700 flex items-center justify-between bg-slate-800/50">
              <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 md:w-5 md:h-5 text-emerald-400 shrink-0" />
                Kiểm tra Dữ liệu ({previewData.length} câu)
              </h2>
              <button 
                onClick={() => setPreviewData(null)}
                className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
              >
                <X className="w-4 h-4 md:w-5 md:h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-0">
              <div className="min-w-full inline-block align-middle">
                <table className="min-w-full divide-y divide-slate-700">
                  <thead className="bg-slate-800/80">
                    <tr>
                      <th scope="col" className="px-3 md:px-6 py-2 md:py-3 text-left text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider w-8 md:w-16">#</th>
                      <th scope="col" className="px-3 md:px-6 py-2 md:py-3 text-left text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider w-1/2">Câu hỏi</th>
                      <th scope="col" className="px-3 md:px-6 py-2 md:py-3 text-left text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider w-1/2">Đáp án</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50 bg-slate-900/50">
                    {previewData.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-3 md:px-6 py-3 md:py-4 whitespace-nowrap text-xs md:text-sm font-medium text-slate-500">{idx + 1}</td>
                        <td className="px-3 md:px-6 py-3 md:py-4 text-xs md:text-sm text-slate-300 font-medium">
                          {item.question}
                        </td>
                        <td className="px-3 md:px-6 py-3 md:py-4 text-xs md:text-sm text-red-400 font-bold">
                          {item.answer}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="p-3 md:p-4 border-t border-slate-700 bg-slate-800/30 flex justify-end gap-2 md:gap-3">
              <button 
                onClick={() => setPreviewData(null)}
                className="px-3 py-1.5 md:px-4 md:py-2 font-medium text-slate-300 hover:bg-slate-700 rounded-xl transition-colors text-xs md:text-sm"
              >
                Hủy bỏ
              </button>
              <button 
                onClick={async () => {
                  if (!previewData || !currentUser) {
                    setAlertDialog("Vui lòng đăng nhập để nạp dữ liệu.");
                    return;
                  }
                  
                  const existingQuestions = new Set(knowledgeBase.map(item => item.question?.trim().toLowerCase()));
                  const filteredPreview: QAPair[] = [];
                  for (const item of previewData) {
                     const qs = item.question?.trim().toLowerCase();
                     if (!existingQuestions.has(qs)) {
                        filteredPreview.push(item);
                        existingQuestions.add(qs); 
                     }
                  }

                  if (filteredPreview.length === 0) {
                     setAlertDialog("Tất cả dữ liệu này đều đã có sẵn trong cơ sở dữ liệu (bị trùng).");
                     setPreviewData(null);
                     return;
                  }

                  try {
                    for (let i = 0; i < filteredPreview.length; i += 400) {
                        const chunk = filteredPreview.slice(i, i + 400);
                        const batch = writeBatch(db);
                        chunk.forEach(item => {
                            const ref = doc(collection(db, 'knowledgeBase'));
                            batch.set(ref, {
                                question: item.question,
                                answer: item.answer,
                                sourceDetail: item.sourceDetail || "",
                                ownerId: currentUser!.uid,
                                createdAt: serverTimestamp(),
                                isPublic: true
                            });
                        });
                        await batch.commit();
                    }
                    setPreviewData(null);
                    setTimeout(() => {
                      if (filteredPreview.length < previewData.length) {
                        const diff = previewData.length - filteredPreview.length;
                        setAlertDialog(`Đã nạp ${filteredPreview.length} câu mới vào cơ sở dữ liệu! (${diff} câu bị trùng đã được tự động loại bỏ).`);
                      } else {
                        setAlertDialog("Đã nạp toàn bộ câu hỏi vào cơ sở dữ liệu dùng chung!");
                      }
                    }, 300);
                  } catch (e: any) {
                    setAlertDialog("Lỗi nạp dữ liệu: " + e.message);
                  }
                }}
                className="px-4 py-2 md:px-6 md:py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center gap-2 transition-colors shadow-lg shadow-emerald-900/20 text-xs md:text-sm"
              >
                <Database className="w-4 h-4" /> Nạp Dữ liệu
              </button>
            </div>
          </div>
        </div>
      )}
      {alertDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-2xl shadow-2xl p-6">
            <h3 className="text-xl font-bold text-white mb-4">Thông báo</h3>
            <p className="text-slate-300 mb-6">{alertDialog}</p>
            <div className="flex justify-end">
              <button 
                onClick={() => setAlertDialog(null)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-colors shadow-lg shadow-blue-900/20"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl shadow-2xl p-6">
            <h3 className="text-xl font-bold text-white mb-4">Xác nhận</h3>
            <p className="text-slate-300 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDialog(null)}
                className="px-5 py-2 hover:bg-slate-800 text-slate-300 rounded-xl font-medium text-sm transition-colors"
              >
                Hủy bỏ
              </button>
              <button 
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className={cn(
                  "px-5 py-2 text-white rounded-xl font-bold text-sm transition-colors shadow-lg",
                  confirmDialog.isDestructive 
                    ? "bg-red-600 hover:bg-red-500 shadow-red-900/20"
                    : "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20"
                )}
              >
                Đồng ý
              </button>
            </div>
          </div>
        </div>
      )}

      {isCameraMode && (
        <div className="fixed inset-0 z-[150] bg-black flex flex-col items-center justify-center">
           <video 
             ref={videoRef} 
             autoPlay 
             playsInline 
             muted 
             className="absolute inset-0 w-full h-full object-cover"
           />
           <canvas ref={canvasRef} className="hidden" />
           
           <div className="absolute inset-0 z-10 p-4 md:p-8 flex flex-col justify-between pointer-events-none">
              <div className="flex justify-between items-start pointer-events-auto">
                 <div className="bg-black/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2">
                    <Scan className="w-4 h-4 text-emerald-400" />
                    <span className="text-white text-sm font-bold tracking-widest uppercase">AR Mode</span>
                 </div>
                 <button 
                   onClick={() => setIsCameraMode(false)}
                   className="p-3 bg-black/50 backdrop-blur-md rounded-full border border-white/10 text-white hover:text-red-400 transition-colors"
                 >
                   <X className="w-6 h-6" />
                 </button>
              </div>

              {arAnswers.length > 0 ? (
                <div className="flex flex-col gap-3 pointer-events-auto w-full max-w-sm ml-auto mr-auto lg:mr-0 animate-in slide-in-from-bottom-8 duration-500">
                   <div className="bg-emerald-500/90 backdrop-blur-md px-3 py-1.5 rounded-full self-center lg:self-end flex items-center gap-2 shadow-lg mb-2 border border-emerald-400">
                      <CheckCircle2 className="w-4 h-4 text-emerald-950" />
                      <span className="text-emerald-950 font-black uppercase tracking-wider text-[10px]">Đã nhận diện {arAnswers.length} đáp án</span>
                   </div>
                   {arAnswers.map((ans, idx) => (
                      <div key={idx} className="bg-black/80 backdrop-blur-xl p-4 rounded-2xl border border-emerald-500/50 shadow-2xl">
                         <div className="text-xl font-bold text-emerald-400">
                            {ans.answer}
                         </div>
                      </div>
                   ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4 text-white/50 animate-pulse">
                   <Scan className="w-16 h-16" />
                   <p className="font-medium text-sm tracking-widest uppercase">Đang quét câu hỏi...</p>
                </div>
              )}
           </div>
        </div>
      )}
    </div>
  );
}

