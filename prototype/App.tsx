import React, { useState, useEffect } from 'react';
import { 
  MapPin, Clock, Ticket, Share2, Twitter, Utensils, ChevronRight, 
  Menu, X, Laugh, Coffee, ExternalLink, Sparkles, Zap, Calendar, 
  Search, Filter, ArrowRight, Star, Heart, Drama, Upload, Brain, Smile, Frown, Image as ImageIcon
} from 'lucide-react';

// --- Types & Mock Data ---

type Page = 'TOP' | 'LIST' | 'DETAIL' | 'REGISTER';

interface Event {
  id: string;
  title: string;
  company: string;
  date: string;
  location: string;
  price: string;
  tags: string[];
  image: string;
  color: string;
  accent: string;
  popTag?: string;
}

const EVENTS: Event[] = [
  {
    id: '1',
    title: '夜明けのコーヒー',
    company: '劇団〇〇',
    date: '2025.05.20 - 05.22',
    location: 'ぽんプラザホール',
    price: '¥2,500',
    tags: ['コメディ', '学生歓迎'],
    image: 'https://picsum.photos/seed/coffee/600/400',
    color: 'bg-pop-yellow',
    accent: 'bg-pop-pink',
    popTag: '笑い度 98%'
  },
  {
    id: '2',
    title: '青とサイダー',
    company: 'Theater Blue',
    date: '2025.06.01 - 06.05',
    location: '甘棠館Show劇場',
    price: '¥3,000',
    tags: ['青春', '会話劇'],
    image: 'https://picsum.photos/seed/blue/600/400',
    color: 'bg-pop-blue',
    accent: 'bg-pop-yellow',
    popTag: 'エモさ 120%'
  },
  {
    id: '3',
    title: '機械仕掛けのララバイ',
    company: '劇団ギア',
    date: '2025.06.10 - 06.12',
    location: '福岡市民会館',
    price: '¥4,500',
    tags: ['SF', '音楽劇'],
    image: 'https://picsum.photos/seed/gear/600/400',
    color: 'bg-pop-purple',
    accent: 'bg-pop-green',
    popTag: '生バンド'
  },
  {
    id: '4',
    title: '真夏の夜の悪夢',
    company: 'Classic Remix',
    date: '2025.07.20',
    location: '西鉄ホール',
    price: '¥3,500',
    tags: ['古典改変', 'ホラー'],
    image: 'https://picsum.photos/seed/summer/600/400',
    color: 'bg-pop-pink',
    accent: 'bg-pop-blue'
  }
];

// --- Common Components ---

const Button = ({ children, variant = 'primary', className = '', onClick }: any) => {
  const baseStyle = "font-bold border-2 border-ink rounded-lg shadow-hard active:shadow-none active:translate-y-1 transition-all flex items-center justify-center gap-2";
  const variants = {
    primary: "bg-pop-pink text-white hover:bg-pink-500",
    secondary: "bg-white text-ink hover:bg-gray-50",
    accent: "bg-pop-yellow text-ink hover:bg-yellow-400",
    dark: "bg-ink text-white hover:bg-gray-800",
    purple: "bg-pop-purple text-white hover:bg-purple-600"
  };
  return (
    <button onClick={onClick} className={`${baseStyle} ${variants[variant as keyof typeof variants]} ${className}`}>
      {children}
    </button>
  );
};

const Header = ({ navigate }: { navigate: (page: Page) => void }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? 'bg-paper/90 backdrop-blur-md shadow-sm border-b-2 border-ink/5 py-3' : 'bg-transparent py-4 md:py-6'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 md:px-6 flex items-center justify-between">
        <button onClick={() => navigate('TOP')} className="group flex items-center gap-2">
          <div className="bg-ink text-pop-yellow border-2 border-ink p-1 rounded-full group-hover:bg-pop-pink group-hover:text-white transition-colors">
             <Zap size={20} fill="currentColor" />
          </div>
          <span className="font-display text-lg md:text-xl tracking-tighter text-ink">
            FUKUOKA STAGE
          </span>
        </button>

        <nav className="hidden md:flex items-center bg-white border-2 border-ink rounded-full px-6 py-2 shadow-hard-sm space-x-6 text-sm font-bold text-ink">
          <button onClick={() => navigate('LIST')} className="hover:text-pop-pink transition-colors">公演を探す</button>
          <div className="w-1 h-1 bg-ink rounded-full"></div>
          <button onClick={() => navigate('REGISTER')} className="hover:text-pop-pink transition-colors">劇団の方へ</button>
          <div className="w-1 h-1 bg-ink rounded-full"></div>
          <button className="hover:text-pop-pink transition-colors">特集記事</button>
        </nav>

        <button 
          className="md:hidden text-ink p-2 border-2 border-ink rounded bg-white shadow-hard-sm active:translate-y-1 active:shadow-none"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Menu"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="absolute top-full left-0 w-full bg-paper border-b-2 border-ink p-6 flex flex-col space-y-4 md:hidden shadow-hard animate-in slide-in-from-top-5 z-50">
          <button onClick={() => { navigate('LIST'); setMobileMenuOpen(false); }} className="text-lg font-bold text-left hover:text-pop-pink py-2 border-b border-ink/10">公演を探す</button>
          <button onClick={() => { navigate('REGISTER'); setMobileMenuOpen(false); }} className="text-lg font-bold text-left hover:text-pop-pink py-2 border-b border-ink/10">劇団の方へ</button>
          <button className="text-lg font-bold text-left hover:text-pop-pink py-2">特集記事</button>
        </div>
      )}
    </header>
  );
};

const Footer = ({ navigate }: { navigate: (page: Page) => void }) => (
  <footer className="bg-ink text-white pt-12 pb-8 border-t-4 border-pop-blue mt-16 md:mt-20">
    <div className="max-w-6xl mx-auto px-6 text-center">
      <div onClick={() => navigate('TOP')} className="inline-block border-2 border-white p-2 rounded-full mb-6 cursor-pointer hover:scale-110 transition-transform">
         <Zap size={32} className="text-pop-yellow" fill="currentColor" />
      </div>
      <div className="font-display text-2xl md:text-3xl mb-8 md:mb-10 tracking-wider">FUKUOKA STAGE</div>
      <div className="flex flex-col md:flex-row justify-center gap-4 md:gap-8 text-sm font-bold tracking-widest mb-10">
         <button onClick={() => navigate('LIST')} className="hover:text-pop-pink transition-colors">公演一覧</button>
         <button className="hover:text-pop-blue transition-colors">今週末のイベント</button>
         <button onClick={() => navigate('REGISTER')} className="hover:text-pop-yellow transition-colors">劇団登録</button>
      </div>
      <p className="text-xs text-white/40 font-mono">&copy; 2025 FUKUOKA STAGE.</p>
    </div>
  </footer>
);

// --- Page Components ---

// 1. TOP PAGE
const TopPage = ({ navigate }: { navigate: (page: Page) => void }) => {
  return (
    <div className="pt-20 md:pt-24 pb-12 animate-in fade-in duration-500">
      
      {/* Mood Search Section (New Request) */}
      <section className="max-w-6xl mx-auto px-4 md:px-6 mb-12">
        <div className="bg-white/50 backdrop-blur-sm border-2 border-ink rounded-2xl p-6 md:p-8 shadow-hard text-center">
           <h2 className="font-display text-2xl md:text-3xl text-ink mb-6 flex items-center justify-center gap-2">
             <Sparkles className="text-pop-yellow" fill="currentColor" />
             <span>今、どんな気分？</span>
           </h2>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Laugh */}
              <button onClick={() => navigate('LIST')} className="group relative bg-white border-2 border-ink rounded-xl p-6 hover:bg-pop-yellow/10 transition-all hover:-translate-y-1 shadow-hard-sm hover:shadow-hard">
                 <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-pop-yellow text-ink border-2 border-ink p-2 rounded-full group-hover:scale-110 transition-transform">
                    <Smile size={24} />
                 </div>
                 <h3 className="font-display text-xl mt-4 mb-2">とにかく笑いたい</h3>
                 <p className="text-xs font-bold text-ink/60">#コメディ #コント #爆笑</p>
              </button>

              {/* Cry/Moved */}
              <button onClick={() => navigate('LIST')} className="group relative bg-white border-2 border-ink rounded-xl p-6 hover:bg-pop-blue/10 transition-all hover:-translate-y-1 shadow-hard-sm hover:shadow-hard">
                 <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-pop-blue text-white border-2 border-ink p-2 rounded-full group-hover:scale-110 transition-transform">
                    <Heart size={24} fill="currentColor" />
                 </div>
                 <h3 className="font-display text-xl mt-4 mb-2">心を揺さぶりたい</h3>
                 <p className="text-xs font-bold text-ink/60">#感動 #人間ドラマ #青春</p>
              </button>

              {/* Think/Insight */}
              <button onClick={() => navigate('LIST')} className="group relative bg-white border-2 border-ink rounded-xl p-6 hover:bg-pop-purple/10 transition-all hover:-translate-y-1 shadow-hard-sm hover:shadow-hard">
                 <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-pop-purple text-white border-2 border-ink p-2 rounded-full group-hover:scale-110 transition-transform">
                    <Brain size={24} />
                 </div>
                 <h3 className="font-display text-xl mt-4 mb-2">没頭して考えたい</h3>
                 <p className="text-xs font-bold text-ink/60">#サスペンス #社会派 #衝撃</p>
              </button>
           </div>
        </div>
      </section>

      {/* Main Hero (Existing) */}
      <section className="max-w-6xl mx-auto px-4 md:px-6 mb-16 md:mb-24">
        <div className="bg-white border-2 border-ink rounded-xl p-6 md:p-12 shadow-hard md:shadow-hard-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 md:w-64 md:h-64 bg-pop-yellow rounded-full blur-3xl opacity-20 -translate-y-1/2 translate-x-1/2"></div>
          
          <div className="grid lg:grid-cols-2 gap-8 md:gap-12 items-center relative z-10">
            <div>
              <div className="inline-block bg-pop-pink text-white font-bold text-[10px] md:text-xs px-3 py-1 rounded-full border-2 border-ink mb-3 md:mb-4 shadow-hard-sm">
                NEW RELEASE
              </div>
              <h1 className="font-display text-4xl md:text-5xl lg:text-7xl leading-none text-ink mb-4 md:mb-6">
                FUKUOKA<br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-pop-blue to-pop-green">THEATER</span><br/>
                LIFE.
              </h1>
              <p className="font-bold text-ink/70 text-sm md:text-lg mb-6 md:mb-8 leading-relaxed">
                福岡の演劇シーンを、もっとポップに。<br className="hidden md:inline" />
                今週末、あなたの心揺さぶる1ステージを見つけよう。
              </p>
              
              <div className="bg-paper p-2 rounded-lg border-2 border-ink flex flex-col sm:flex-row gap-2 shadow-hard w-full sm:w-auto">
                <input 
                  type="text" 
                  placeholder="キーワード検索..." 
                  className="bg-transparent px-3 py-2 font-bold text-ink outline-none placeholder:text-ink/30 w-full sm:w-48 lg:w-64 text-sm md:text-base" 
                />
                <Button variant="dark" onClick={() => navigate('LIST')} className="w-full sm:w-auto py-2 px-4">
                  <Search size={18} />
                  <span className="sm:hidden">検索</span>
                </Button>
              </div>
            </div>

            {/* Featured Event Card (Mini) */}
            <div className="relative group cursor-pointer mt-4 lg:mt-0" onClick={() => navigate('DETAIL')}>
              <div className="absolute inset-0 bg-ink rounded-xl transform translate-x-1 translate-y-1 md:translate-x-2 md:translate-y-2"></div>
              <div className="relative bg-white border-2 border-ink rounded-xl overflow-hidden aspect-video transition-transform group-hover:-translate-y-1 group-hover:-translate-x-1">
                <img src={EVENTS[0].image} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-ink/90 to-transparent p-4 md:p-6 pt-12 text-white">
                  <span className="bg-pop-yellow text-ink text-[10px] font-black px-2 py-0.5 rounded mb-2 inline-block">PICK UP</span>
                  <h3 className="font-display text-xl md:text-2xl">{EVENTS[0].title}</h3>
                  <p className="text-xs md:text-sm font-bold opacity-80">{EVENTS[0].date}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="max-w-6xl mx-auto px-4 md:px-6 mb-16 md:mb-24">
        <div className="flex items-center gap-3 mb-6 md:mb-8">
          <div className="w-3 h-3 md:w-4 md:h-4 bg-pop-blue rounded-full border-2 border-ink"></div>
          <h2 className="font-display text-2xl md:text-3xl text-ink">CATEGORIES</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {['コメディ', '会話劇', 'ミュージカル', '古典・時代劇', 'ダンス', '学生演劇', 'コント', '実験的'].map((cat, i) => (
            <button key={i} onClick={() => navigate('LIST')} className="group bg-white border-2 border-ink rounded-lg p-4 md:p-6 text-center shadow-hard-sm hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all">
              <span className={`inline-block p-2 md:p-3 rounded-full border-2 border-ink mb-2 md:mb-3 ${
                i % 4 === 0 ? 'bg-pop-yellow' : i % 4 === 1 ? 'bg-pop-pink' : i % 4 === 2 ? 'bg-pop-blue' : 'bg-pop-green'
              }`}>
                <Drama size={20} className="md:w-6 md:h-6 text-ink" />
              </span>
              <div className="font-bold text-ink text-sm md:text-base">{cat}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Trending / List Preview */}
      <section className="max-w-6xl mx-auto px-4 md:px-6">
        <div className="flex justify-between items-end mb-6 md:mb-8">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 md:w-4 md:h-4 bg-pop-pink rounded-full border-2 border-ink"></div>
            <h2 className="font-display text-2xl md:text-3xl text-ink">TRENDING</h2>
          </div>
          <button onClick={() => navigate('LIST')} className="text-xs font-bold border-b-2 border-ink hover:text-pop-blue hover:border-pop-blue transition-colors flex items-center gap-1 pb-1">
            VIEW ALL <ArrowRight size={12} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
          {EVENTS.slice(0, 3).map((event) => (
            <div key={event.id} onClick={() => navigate('DETAIL')} className="group cursor-pointer bg-white border-2 border-ink rounded-lg p-3 shadow-hard hover:shadow-hard-lg hover:-translate-y-1 transition-all">
              <div className="relative aspect-[4/3] bg-gray-100 rounded border-2 border-ink overflow-hidden mb-4">
                <img src={event.image} alt={event.title} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                {event.popTag && (
                  <div className={`absolute top-2 right-2 ${event.accent} text-white text-[10px] font-bold px-2 py-1 rounded border border-ink shadow-sm`}>
                    {event.popTag}
                  </div>
                )}
              </div>
              <h3 className="font-display text-xl leading-tight mb-2 group-hover:text-pop-pink transition-colors">{event.title}</h3>
              <p className="text-xs font-bold text-ink/60 mb-3">{event.company}</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {event.tags.map(tag => (
                  <span key={tag} className="text-[10px] font-bold bg-gray-100 px-2 py-1 rounded border border-ink/10">{tag}</span>
                ))}
              </div>
              <div className="flex justify-between items-center pt-3 border-t-2 border-dashed border-gray-200">
                <div className="flex items-center gap-1 text-xs font-bold text-ink/70">
                  <Calendar size={12} /> {event.date.split(' - ')[0]}
                </div>
                <div className="bg-ink text-white text-xs font-bold px-2 py-1 rounded-sm">
                  予約可
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
};

// 2. LIST PAGE
const ListPage = ({ navigate }: { navigate: (page: Page) => void }) => {
  return (
    <div className="pt-20 md:pt-24 pb-12 animate-in slide-in-from-right-10 duration-500">
      <div className="max-w-6xl mx-auto px-4 md:px-6">
        
        {/* Page Title */}
        <div className="mb-8 md:mb-12 text-center">
          <h1 className="font-display text-3xl md:text-4xl mb-2 md:mb-4">ALL EVENTS</h1>
          <p className="font-bold text-ink/60 text-sm md:text-base">福岡エリアの演劇公演一覧</p>
        </div>

        {/* Filters */}
        <div className="bg-white border-2 border-ink rounded-lg p-3 md:p-4 mb-8 md:mb-12 shadow-hard-sm sticky top-16 md:top-24 z-30 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
           <div className="flex gap-2 overflow-x-auto w-full sm:w-auto no-scrollbar pb-1 sm:pb-0">
             <button className="whitespace-nowrap bg-ink text-white px-3 md:px-4 py-1.5 md:py-2 rounded font-bold text-xs md:text-sm border-2 border-ink flex-shrink-0">すべて</button>
             <button className="whitespace-nowrap bg-white text-ink px-3 md:px-4 py-1.5 md:py-2 rounded font-bold text-xs md:text-sm border-2 border-ink hover:bg-gray-50 flex-shrink-0">今週末</button>
             <button className="whitespace-nowrap bg-white text-ink px-3 md:px-4 py-1.5 md:py-2 rounded font-bold text-xs md:text-sm border-2 border-ink hover:bg-gray-50 flex-shrink-0">来月</button>
             <div className="w-px h-6 md:h-8 bg-gray-200 mx-1 md:mx-2 flex-shrink-0"></div>
             <button className="whitespace-nowrap bg-white text-ink px-3 md:px-4 py-1.5 md:py-2 rounded font-bold text-xs md:text-sm border-2 border-ink hover:bg-gray-50 flex items-center gap-1 flex-shrink-0"><Filter size={14}/> 絞り込み</button>
           </div>
           <div className="text-[10px] md:text-xs font-bold text-ink/50 ml-auto sm:ml-0">
             Showing 4 events
           </div>
        </div>

        {/* List Grid */}
        <div className="grid gap-4 md:gap-6">
          {EVENTS.map((event, i) => (
            <div key={event.id} onClick={() => navigate('DETAIL')} className="group cursor-pointer bg-white border-2 border-ink rounded-xl p-0 shadow-hard hover:shadow-hard-lg hover:-translate-y-1 transition-all overflow-hidden flex flex-col md:flex-row">
              {/* Poster Side */}
              <div className="md:w-1/3 h-40 sm:h-48 md:h-auto relative border-b-2 md:border-b-0 md:border-r-2 border-ink shrink-0">
                <img src={event.image} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                <div className={`absolute top-3 left-3 md:top-4 md:left-4 ${event.color} border-2 border-ink text-ink font-black text-[10px] md:text-xs px-2 md:px-3 py-0.5 md:py-1 rounded shadow-sm`}>
                  {event.tags[0]}
                </div>
              </div>

              {/* Info Side */}
              <div className="flex-1 p-4 md:p-6 flex flex-col justify-between relative bg-dot-pattern">
                 {/* Ticket Stub Deco (Desktop only) */}
                 <div className="absolute top-1/2 -left-3 w-6 h-6 bg-paper rounded-full border-2 border-ink hidden md:block"></div>

                 <div>
                   <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] md:text-xs font-bold text-ink/60 bg-white border border-ink/20 px-2 py-0.5 rounded">{event.company}</span>
                      <div className="flex gap-2">
                        <Heart size={18} className="text-ink/20 hover:text-pop-pink cursor-pointer transition-colors" />
                      </div>
                   </div>
                   <h2 className="font-display text-xl md:text-2xl mb-2 md:mb-3 group-hover:text-pop-blue transition-colors leading-tight">{event.title}</h2>
                   <div className="space-y-1.5 md:space-y-2 mb-4">
                     <div className="flex items-center gap-2 text-xs md:text-sm font-bold text-ink/80">
                        <Calendar size={14} className="md:w-4 md:h-4 text-pop-pink" /> {event.date}
                     </div>
                     <div className="flex items-center gap-2 text-xs md:text-sm font-bold text-ink/80">
                        <MapPin size={14} className="md:w-4 md:h-4 text-pop-green" /> {event.location}
                     </div>
                   </div>
                 </div>

                 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end border-t-2 border-dashed border-ink/10 pt-3 md:pt-4 gap-3 sm:gap-0">
                    <div>
                      <span className="text-[10px] font-bold text-ink/50 block">TICKET</span>
                      <span className="font-display text-lg md:text-xl">{event.price}</span>
                    </div>
                    <Button variant="accent" className="w-full sm:w-auto px-4 md:px-6 py-2 text-sm">
                      詳細を見る <ChevronRight size={14} />
                    </Button>
                 </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Pagination */}
        <div className="flex justify-center gap-2 mt-12 md:mt-16">
          <button className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center bg-ink text-white font-bold rounded border-2 border-ink shadow-hard-sm text-sm">1</button>
          <button className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center bg-white text-ink font-bold rounded border-2 border-ink hover:bg-gray-50 text-sm">2</button>
          <button className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center bg-white text-ink font-bold rounded border-2 border-ink hover:bg-gray-50 text-sm">3</button>
        </div>

      </div>
    </div>
  );
};

// 3. DETAIL PAGE (Previously Night's Coffee)
const DetailPage = ({ navigate }: { navigate: (page: Page) => void }) => {
  return (
    <div className="animate-in fade-in duration-500">
      {/* Breadcrumbs */}
      <nav className="max-w-6xl mx-auto px-4 md:px-6 pt-20 md:pt-24 pb-4 overflow-x-auto no-scrollbar">
        <ol className="flex items-center space-x-2 text-[10px] md:text-xs font-bold whitespace-nowrap text-ink/60">
          <li><button onClick={() => navigate('TOP')} className="hover:text-pop-blue border-b-2 border-transparent hover:border-pop-blue transition-colors">TOP</button></li>
          <li><ChevronRight size={10} /></li>
          <li><button onClick={() => navigate('LIST')} className="hover:text-pop-blue border-b-2 border-transparent hover:border-pop-blue transition-colors">福岡エリア</button></li>
          <li><ChevronRight size={10} /></li>
          <li><span className="bg-pop-yellow/30 px-2 py-1 rounded text-ink">夜明けのコーヒー</span></li>
        </ol>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 md:px-6 mb-12 md:mb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          <div className="lg:col-span-7 relative order-2 lg:order-1">
            <div className="relative group">
              <div className="absolute top-2 left-2 md:top-4 md:left-4 w-full h-full bg-pop-blue border-2 border-ink rounded-xl"></div>
              <div className="relative aspect-video bg-white border-2 border-ink rounded-xl overflow-hidden hover:-translate-y-1 hover:-translate-x-1 transition-transform duration-300">
                <img src="https://picsum.photos/1200/675?grayscale" alt="Night's Coffee Stage Play" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                <div className="absolute inset-0 bg-ink/10 mix-blend-multiply pointer-events-none"></div>
                
                {/* Responsive Position for Tag */}
                <div className="absolute bottom-2 right-2 md:-bottom-6 md:-right-4 bg-pop-pink text-white font-display px-4 py-2 md:px-6 md:py-3 rounded-full border-2 border-ink shadow-hard-sm transform md:rotate-6 animate-float flex items-center gap-1 md:gap-2 z-10 scale-90 md:scale-100 origin-bottom-right">
                  <Laugh className="text-pop-yellow w-4 h-4 md:w-6 md:h-6" fill="currentColor" />
                  <span className="text-base md:text-xl tracking-tighter">笑い度 98%</span>
                </div>
              </div>
            </div>
          </div>
          <div className="lg:col-span-5 order-1 lg:order-2 flex flex-col justify-center">
            <div className="flex flex-wrap gap-2 mb-4 md:mb-6">
              <span className="px-2 md:px-3 py-1 bg-pop-yellow border-2 border-ink text-ink text-[10px] md:text-xs font-black rounded shadow-hard-sm">コメディ</span>
              <span className="px-2 md:px-3 py-1 bg-white border-2 border-ink text-ink text-[10px] md:text-xs font-bold rounded shadow-hard-sm">学生・一般歓迎</span>
            </div>
            <h1 className="font-rounded font-extrabold text-3xl md:text-4xl lg:text-5xl leading-tight md:leading-none text-ink mb-4 md:mb-6">
              <span className="block text-sm md:text-lg font-bold text-pop-pink mb-1 md:mb-2 tracking-widest uppercase">Theatrical Play</span>
              夜明けの<span className="relative inline-block ml-2 z-0">コーヒー<span className="absolute bottom-1 left-0 w-full h-3 md:h-4 bg-pop-blue/40 -z-10 transform -rotate-2"></span></span>
            </h1>
            <p className="text-ink/70 text-sm md:text-base font-medium leading-relaxed mb-6 md:mb-8">
              劇団〇〇 第15回本公演。<br/>港町の純喫茶で繰り広げられる、<br/>嘘と本音のノンストップ・シチュエーションコメディ！
            </p>
            <div className="flex flex-col gap-3 md:gap-4">
               <div className="flex items-center gap-3 md:gap-4 bg-white border-2 border-ink p-3 md:p-4 rounded-lg shadow-hard-sm">
                  <div className="bg-pop-green p-1.5 md:p-2 rounded-full border-2 border-ink text-white"><Calendar size={16} className="md:w-5 md:h-5" /></div>
                  <div><div className="text-[10px] md:text-xs font-bold text-ink/50 uppercase">Date</div><div className="font-display text-lg md:text-xl text-ink">2025.05.20 <span className="text-xs md:text-sm font-sans text-ink/50 mx-1">to</span> 05.22</div></div>
               </div>
               <div className="flex items-center gap-3 md:gap-4 bg-white border-2 border-ink p-3 md:p-4 rounded-lg shadow-hard-sm">
                  <div className="bg-pop-purple p-1.5 md:p-2 rounded-full border-2 border-ink text-white"><Clock size={16} className="md:w-5 md:h-5" /></div>
                  <div><div className="text-[10px] md:text-xs font-bold text-ink/50 uppercase">Time</div><div className="font-bold text-base md:text-lg text-ink">全5ステージ</div></div>
               </div>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 max-w-6xl mx-auto px-4 md:px-6 pb-12 md:pb-24">
        <main className="lg:col-span-8 space-y-12 md:space-y-20">
          <section>
            <div className="flex items-center gap-3 mb-6 md:mb-8">
              <div className="bg-pop-yellow w-6 h-6 md:w-8 md:h-8 rounded-full border-2 border-ink flex items-center justify-center"><Sparkles size={14} className="md:w-4 md:h-4 text-ink" /></div>
              <h2 className="font-display text-2xl md:text-3xl text-ink">STORY</h2>
            </div>
            <div className="bg-white p-6 md:p-8 rounded-xl md:rounded-2xl border-2 border-ink shadow-hard relative overflow-hidden">
               <div className="absolute -right-10 -top-10 w-32 h-32 bg-pop-pink/10 rounded-full blur-2xl"></div>
               <p className="text-base md:text-lg font-bold leading-relaxed mb-4 md:mb-6">とある港町の純喫茶<span className="bg-pop-blue/30 px-1 rounded mx-1">「サンライズ」</span>。マスターが入れるコーヒーには、飲んだ人の「嘘」が見抜ける不思議な力が宿っていた。</p>
               <p className="text-sm md:text-base text-ink/80 leading-loose">そこに逃げ込んできたのは、結婚詐欺師の男と、彼を追うドジな刑事。カウンター越しに交錯する、過去と現在、真実と虚構。<br/>「あんたのその言葉、ブラックコーヒーより苦いねぇ」<br/>一夜の攻防戦を描く、<span className="border-b-4 border-pop-yellow font-bold">ドタバタハートフルコメディ！</span></p>
            </div>
          </section>

          <section>
             <div className="flex items-center gap-3 mb-6 md:mb-8">
              <div className="bg-pop-pink w-6 h-6 md:w-8 md:h-8 rounded-full border-2 border-ink flex items-center justify-center"><Laugh size={14} className="md:w-4 md:h-4 text-white" /></div>
              <h2 className="font-display text-2xl md:text-3xl text-ink">CAST</h2>
            </div>
             <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-6 md:gap-y-8">
                {[{ name: '山田 太郎', role: 'マスター' }, { name: '佐藤 花子', role: '謎の女' }, { name: '福岡 健太', role: '刑事(客演)' }, { name: '田中 次郎', role: '常連客' }, { name: '鈴木 愛', role: 'アルバイト' }, { name: '高橋 優', role: '詐欺師' }].map((actor, i) => (
                  <div key={i} className="group flex flex-col items-center">
                    <div className="relative mb-3">
                      <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gray-200 border-2 border-ink overflow-hidden z-10 relative group-hover:scale-110 transition-transform duration-300">
                        <img src={`https://picsum.photos/seed/${i + 20}/200`} alt={actor.name} className="w-full h-full object-cover" />
                      </div>
                      <div className={`absolute top-0 left-0 w-full h-full rounded-full border-2 border-ink -z-0 translate-x-1 translate-y-1 ${i % 3 === 0 ? 'bg-pop-yellow' : i % 3 === 1 ? 'bg-pop-blue' : 'bg-pop-pink'}`}></div>
                    </div>
                    <h3 className="font-bold text-base md:text-lg text-ink">{actor.name}</h3>
                    <div className="text-[10px] md:text-xs font-bold text-white bg-ink px-2 py-0.5 rounded-full mt-1">{actor.role}</div>
                  </div>
                ))}
             </div>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-4 md:mb-6">
              <div className="bg-pop-green w-6 h-6 md:w-8 md:h-8 rounded-full border-2 border-ink flex items-center justify-center"><Utensils size={14} className="md:w-4 md:h-4 text-white" /></div>
              <h2 className="font-display text-xl md:text-2xl text-ink">After Party</h2>
            </div>
            <a href="#" className="block group">
              <div className="bg-white rounded-lg md:rounded-xl border-2 border-ink p-1 shadow-hard hover:shadow-hard-lg hover:-translate-y-1 transition-all">
                <div className="flex items-stretch">
                  <div className="w-28 md:w-1/3 min-h-[100px] md:min-h-[120px] bg-gray-100 rounded-l md:rounded-l-lg border-r-2 border-ink overflow-hidden relative shrink-0">
                     <img src="https://picsum.photos/seed/yakitori/300" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="Yakitori" />
                     <div className="absolute top-2 left-2 bg-pop-yellow text-[10px] font-bold px-2 py-1 rounded border border-ink">徒歩3分</div>
                  </div>
                  <div className="flex-1 p-3 md:p-4 flex flex-col justify-center">
                    <h3 className="font-bold text-lg md:text-xl text-ink mb-1 md:mb-2 group-hover:text-pop-blue transition-colors">炭火焼鳥 天（てん）</h3>
                    <p className="text-xs md:text-sm text-ink/60 mb-2 md:mb-3 line-clamp-2">観劇後はここで決まり！チケット提示で1ドリンクサービス。</p>
                    <div className="flex items-center text-xs font-bold text-pop-pink">お店の詳細をチェック <ChevronRight size={12} className="md:w-3.5 md:h-3.5" /></div>
                  </div>
                </div>
              </div>
            </a>
          </section>
        </main>

        <aside className="lg:col-span-4 space-y-6 md:space-y-8">
          <div className="static lg:sticky lg:top-24">
            <div className="bg-white border-2 border-ink rounded-lg shadow-hard-pink overflow-hidden">
               <div className="bg-ink p-3 md:p-4 flex justify-between items-center text-white">
                  <span className="font-display text-base md:text-lg tracking-wider">TICKET</span>
                  <div className="flex gap-1"><div className="w-2 h-2 rounded-full bg-pop-pink"></div><div className="w-2 h-2 rounded-full bg-pop-yellow"></div><div className="w-2 h-2 rounded-full bg-pop-blue"></div></div>
               </div>
               <div className="p-4 md:p-6 relative bg-white">
                  <div className="text-center mb-4 md:mb-6">
                    <p className="font-bold text-lg md:text-xl text-ink mb-1">ぽんプラザホール</p>
                    <div className="flex justify-center items-center gap-1 text-[10px] md:text-xs font-bold text-ink/50 bg-gray-100 py-1 px-2 rounded-full inline-flex mx-auto"><MapPin size={10} className="md:w-3 md:h-3" /> 福岡市博多区祇園町8-3</div>
                  </div>
                  <div className="space-y-2 md:space-y-3 mb-4 md:mb-6">
                    <div className="flex justify-between items-center border-b-2 border-dashed border-gray-200 pb-2"><span className="font-bold text-sm md:text-base text-ink/70">一般</span><span className="font-display text-xl md:text-2xl text-pop-pink">¥2,500</span></div>
                    <div className="flex justify-between items-center border-b-2 border-dashed border-gray-200 pb-2"><span className="font-bold text-sm md:text-base text-ink/70">学生</span><span className="font-display text-lg md:text-xl text-ink">¥1,500</span></div>
                  </div>
                  <Button className="w-full py-3 md:py-4 text-sm md:text-base" variant="primary">
                    <Ticket size={18} className="md:w-5 md:h-5 group-hover:rotate-12 transition-transform" /><span>予約へ進む</span><ExternalLink size={14} className="md:w-4 md:h-4 opacity-80" />
                  </Button>
                  <p className="text-[10px] text-center mt-2 md:mt-3 text-ink/40 font-bold">※CoRichチケットへ移動します</p>
               </div>
               <div className="h-2 bg-pop-yellow border-t-2 border-ink"></div>
            </div>
            <div className="mt-4 md:mt-6 grid grid-cols-2 gap-3">
               <Button variant="dark" className="py-2.5 md:py-3 text-xs md:text-sm"><Twitter size={14} className="md:w-4 md:h-4" /> ポスト</Button>
               <Button className="bg-[#06C755] text-white py-2.5 md:py-3 text-xs md:text-sm border-[#048a3b] hover:bg-[#05b54d]"><Share2 size={14} className="md:w-4 md:h-4" /> LINE</Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

// 4. REGISTER PAGE (New)
const RegisterPage = ({ navigate }: { navigate: (page: Page) => void }) => {
  const [joy, setJoy] = useState(50);
  const [sadness, setSadness] = useState(20);
  const [thinking, setThinking] = useState(20);

  return (
    <div className="pt-20 md:pt-24 pb-12 animate-in fade-in duration-500 max-w-2xl mx-auto px-4">
      
      {/* Header Area */}
      <div className="bg-ink text-white rounded-t-xl p-8 border-2 border-ink mb-0 shadow-hard relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="text-pop-yellow animate-pulse" />
            <span className="font-bold text-pop-yellow">THEATER MAKER</span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl mb-2">公演登録 & AI宣伝</h1>
          <p className="text-white/60 text-sm">チラシをアップして感情を設定するだけで、宣伝キットを作成します。</p>
        </div>
        <div className="absolute -right-4 -bottom-4 opacity-10">
          <Zap size={120} />
        </div>
      </div>

      {/* Form Container */}
      <div className="bg-white border-2 border-ink border-t-0 rounded-b-xl p-6 md:p-8 shadow-hard mb-12">
        
        {/* Step 1: Info */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-ink text-white flex items-center justify-center font-display text-lg">1</div>
            <h2 className="font-bold text-xl text-ink">公演情報</h2>
          </div>
          
          <div className="space-y-4">
            <input type="text" placeholder="公演タイトル" className="w-full bg-paper border-2 border-ink/20 rounded-lg p-3 font-bold text-ink focus:border-pop-blue focus:outline-none transition-colors" />
            <input type="text" placeholder="劇団名" className="w-full bg-paper border-2 border-ink/20 rounded-lg p-3 font-bold text-ink focus:border-pop-blue focus:outline-none transition-colors" />
            <textarea placeholder="あらすじ・詳細 (脚本の概要でもOK)" rows={4} className="w-full bg-paper border-2 border-ink/20 rounded-lg p-3 font-bold text-ink focus:border-pop-blue focus:outline-none transition-colors"></textarea>
            
            {/* File Upload */}
            <div className="border-2 border-dashed border-pop-blue/50 bg-pop-blue/5 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-pop-blue/10 transition-colors group">
               <Upload size={32} className="text-pop-blue mb-2 group-hover:scale-110 transition-transform" />
               <span className="font-bold text-pop-blue">チラシ画像をアップロード</span>
            </div>
          </div>
        </div>

        {/* Step 2: Emotion Params */}
        <div className="mb-10 bg-paper p-6 rounded-xl border-2 border-ink/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-ink text-white flex items-center justify-center font-display text-lg">2</div>
            <h2 className="font-bold text-xl text-ink">感情パラメーター設定</h2>
          </div>
          <p className="text-sm font-bold text-ink/50 mb-6">作品の「成分」を設定してください。</p>

          <div className="space-y-8">
            {/* Joy */}
            <div>
              <div className="flex justify-between font-bold text-ink mb-2">
                <span className="flex items-center gap-2"><Laugh size={18} className="text-pop-yellow" /> 笑い / コメディ</span>
                <span className="text-pop-yellow">{joy}%</span>
              </div>
              <input 
                type="range" min="0" max="100" value={joy} 
                onChange={(e) => setJoy(parseInt(e.target.value))}
                className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-pop-yellow"
              />
            </div>

            {/* Sadness */}
            <div>
              <div className="flex justify-between font-bold text-ink mb-2">
                <span className="flex items-center gap-2"><Frown size={18} className="text-pop-blue" /> 涙 / 感動</span>
                <span className="text-pop-blue">{sadness}%</span>
              </div>
              <input 
                type="range" min="0" max="100" value={sadness} 
                onChange={(e) => setSadness(parseInt(e.target.value))}
                className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-pop-blue"
              />
            </div>

            {/* Thinking */}
            <div>
              <div className="flex justify-between font-bold text-ink mb-2">
                <span className="flex items-center gap-2"><Brain size={18} className="text-pop-purple" /> 思考 / 社会派・衝撃</span>
                <span className="text-pop-purple">{thinking}%</span>
              </div>
              <input 
                type="range" min="0" max="100" value={thinking} 
                onChange={(e) => setThinking(parseInt(e.target.value))}
                className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-pop-purple"
              />
            </div>
          </div>
        </div>

        {/* CTA */}
        <Button variant="purple" className="w-full py-4 text-lg shadow-hard-lg hover:translate-y-1 hover:shadow-hard transition-all">
           <Sparkles className="animate-pulse" /> AI宣伝キット生成
        </Button>

      </div>
    </div>
  );
};

// --- App Layout & Routing ---

const App = () => {
  const [currentPage, setCurrentPage] = useState<Page>('TOP'); // Changed default to TOP for better flow

  // Simulate routing
  const navigate = (page: Page) => {
    window.scrollTo(0, 0);
    setCurrentPage(page);
  };

  return (
    <div className="min-h-screen relative font-sans dot-pattern flex flex-col">
      <Header navigate={navigate} />
      
      <main className="flex-grow">
        {currentPage === 'TOP' && <TopPage navigate={navigate} />}
        {currentPage === 'LIST' && <ListPage navigate={navigate} />}
        {currentPage === 'DETAIL' && <DetailPage navigate={navigate} />}
        {currentPage === 'REGISTER' && <RegisterPage navigate={navigate} />}
      </main>

      <Footer navigate={navigate} />
    </div>
  );
};

export default App;