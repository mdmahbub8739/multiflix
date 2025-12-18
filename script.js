/* --- START OF FILE script.js --- */

const SUPABASE_URL = "https://zgktvncvqpwxhbigdfks.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpna3R2bmN2cXB3eGhiaWdkZmtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzMjczNDcsImV4cCI6MjA3OTkwMzM0N30.-FntryjMRyBBCeWHL7eB_sZbq1rKF4-RsPEdbSriQP8";
const {
    createClient
} = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const TMDB_API_KEY = "21c94d1181ff795c2eef4fb690d24ab6";

// Global Cache
let contentCache = new Map();
let userFavorites = [],
    popularPeople = [],
    currentUser = null,
    currentOpenId = null,
    currentSeriesData = null;

// --- HERO SLIDER STATE ---
let currentHeroIndex = 0;
let heroItems = [];
let heroTimer;

// Pagination State
let pageState = {
    activePage: 'home-page',
    movies: {
        offset: 0,
        limit: 20
    },
    series: {
        offset: 0,
        limit: 20
    },
    tmdb: {
        page: 1,
        genreId: null,
        type: 'movie'
    },
    similar: {
        offset: 0,
        limit: 20,
        genre: null,
        type: null,
        excludeId: null
    },
    isLoading: false
};

let activeServerList = [],
    activeServerIndex = 0;

// --- ROUTER HELPER FUNCTIONS ---

function createSlug(text) {
    if (!text) return 'unknown';
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}

function updateHistoryState(url) {
    if (window.location.pathname !== url) {
        history.pushState(null, null, url);
    }
}

async function router() {
    const path = window.location.pathname;

    const movieMatch = path.match(/^\/movie\/(\d+)/);
    if (movieMatch) {
        const id = movieMatch[1];
        await openPlayerPage(id, 'movie', false);
        return;
    }

    const seriesMatch = path.match(/^\/series\/(\d+)(?:\/[^\/]+)?(?:\/season\/(\d+)\/episode\/(\d+))?/);
    if (seriesMatch) {
        const id = seriesMatch[1];
        const seasonNum = seriesMatch[2] ? parseInt(seriesMatch[2]) : null;
        const episodeNum = seriesMatch[3] ? parseInt(seriesMatch[3]) : null;

        await openPlayerPage(id, 'series', false);

        if (seasonNum && episodeNum && currentSeriesData) {
            const seasonIdx = seasonNum - 1;
            const episodeIdx = episodeNum - 1;

            setTimeout(() => {
                const select = document.getElementById('season-select');
                if (select) {
                    if (select.querySelector(`option[value="${seasonIdx}"]`)) {
                        select.value = seasonIdx;
                        renderEpisodes(seasonIdx);
                    } else if (select.querySelector('option[value="flat"]')) {
                        select.value = 'flat';
                        renderEpisodes('flat');
                    }

                    let targetSeason = (currentSeriesData.seasons && currentSeriesData.seasons[seasonIdx]) ? currentSeriesData.seasons[seasonIdx] : null;
                    let eps = targetSeason ? targetSeason.episodes : currentSeriesData.episodes;

                    if (eps && eps[episodeIdx]) {
                        const ep = eps[episodeIdx];
                        let epServers = ep.servers || [];
                        if (epServers.length === 0 && ep.link) epServers = [{
                            name: "Server 1",
                            url: ep.link
                        }];

                        const epData = {
                            title: ep.title || `Episode ${episodeNum}`,
                            servers: epServers,
                            downloadLink: ep.downloadLink
                        };
                        playEpisode(encodeURIComponent(JSON.stringify(epData)), episodeIdx, false);
                    }
                }
            }, 500);
        }
        return;
    }

    if (path !== '/' && path !== '/index.html') {
        history.replaceState(null, null, '/');
    }
    showPage('home-page');
}

window.addEventListener('popstate', () => {
    router();
});

// PWA
let deferredPrompt;
const installBtn = document.getElementById('install-app-btn');
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.remove('hidden');
});
installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const {
            outcome
        } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBtn.classList.add('hidden');
    }
});

function initApp() {
    sb.from('settings').select('*').limit(1).then(({
        data
    }) => {
        if (data && data.length > 0) {
            const val = data[0];
            if (val.color) document.documentElement.style.setProperty('--brand-color', val.color);
            if (val.app_name) document.title = val.app_name;
            if (val.logo_type === 'image' && val.logo_url) document.getElementById('app-logo-container').innerHTML = `<img src="${val.logo_url}" class="h-8 object-contain">`;
        }
    });

    fetch(`https://api.themoviedb.org/3/person/popular?api_key=${TMDB_API_KEY}&language=en-US&page=1`).then(r => r.json()).then(data => {
        popularPeople = data.results || [];
    });

    Promise.all([
        sb.from('movies').select('*').order('created_at', {
            ascending: false
        }).limit(5),
        sb.from('series').select('*').order('created_at', {
            ascending: false
        }).limit(20), // Increased limit for episodes
        sb.from('movies').select('*').order('created_at', {
            ascending: false
        }).range(5, 15)
    ]).then(([bannerData, seriesData, moviesData]) => {
        [...(bannerData.data || []), ...(seriesData.data || []), ...(moviesData.data || [])].forEach(i => contentCache.set(String(i.id), {
            ...i,
            type: i.seasons ? 'series' : 'movie'
        }));
        renderHome(bannerData.data || [], moviesData.data || [], seriesData.data || []);
        document.getElementById('app-splash').style.opacity = '0';
        setTimeout(() => document.getElementById('app-splash').remove(), 500);

        router();
    });

    setupAuthListener();
    setupDragScroll();
}

function setupDragScroll() {
    document.addEventListener('mousedown', (e) => {
        const slider = e.target.closest('.drag-scroll');
        if (!slider) return;
        let isDown = true;
        slider.classList.add('active');
        let startX = e.pageX - slider.offsetLeft;
        let scrollLeft = slider.scrollLeft;
        const mouseUp = () => {
            isDown = false;
            slider.classList.remove('active');
            document.removeEventListener('mouseup', mouseUp);
            document.removeEventListener('mousemove', mouseMove);
        };
        const mouseMove = (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX) * 2;
            slider.scrollLeft = scrollLeft - walk;
        };
        document.addEventListener('mouseup', mouseUp);
        document.addEventListener('mousemove', mouseMove);
    });
}

// --- NEW HELPER: Extract Latest Episode ---
function getLatestEpisode(series) {
    let lastEp = null;
    let label = "";

    // Check if seasons exist
    if (series.seasons && series.seasons.length > 0) {
        const lastSeasonIdx = series.seasons.length - 1;
        const lastSeason = series.seasons[lastSeasonIdx];
        if (lastSeason.episodes && lastSeason.episodes.length > 0) {
            lastEp = lastSeason.episodes[lastSeason.episodes.length - 1];
            label = `S${lastSeasonIdx + 1} E${lastSeason.episodes.length}`;
        }
    }
    // Fallback to flat episodes
    else if (series.episodes && series.episodes.length > 0) {
        lastEp = series.episodes[series.episodes.length - 1];
        label = `Ep ${series.episodes.length}`;
    }

    if (!lastEp) return null;

    return {
        id: series.id,
        type: 'series',
        // Use episode image if available, else series backdrop, else poster
        image: lastEp.still || series.thumbnail || series.poster,
        title: series.title,
        epTitle: lastEp.title || `Episode ${label}`,
        badge: label,
        seasonIndex: series.seasons ? series.seasons.length : 1, // approximate
        episodeIndex: series.seasons ? (series.seasons[series.seasons.length - 1].episodes.length) : series.episodes.length
    };
}

// --- NEW HELPER: Create Landscape Card ---
function createLandscapeCard(item) {
    // Construct URL for specific episode if possible, otherwise series link
    const slug = createSlug(item.title);
    // Note: We point to the series page. The router/player logic handles finding the specific episode if we passed params,
    // but for simplicity, we open the series page.
    // To deep link: onclick="openPlayerPage('${item.id}','series');" followed by logic to select ep.

    return `
    <div onclick="openPlayerPage('${item.id}','series')" class="flex-none w-64 md:w-80 cursor-pointer relative group animate-fade-in">
        <div class="aspect-video rounded-xl overflow-hidden bg-surface border border-white/10 relative shadow-lg">
            <img src="${item.image}" class="w-full h-full object-cover transition duration-500 group-hover:scale-110" loading="lazy">
            <div class="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80"></div>
            
            <!-- Badge -->
            <div class="absolute top-2 right-2 bg-brand text-white text-[10px] font-black px-2 py-1 rounded shadow-md uppercase tracking-wider">
                ${item.badge}
            </div>
            
            <!-- Play Icon Overlay -->
            <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-300">
                <div class="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white">
                    <i class="ri-play-fill text-2xl ml-1"></i>
                </div>
            </div>

            <!-- Text Info -->
            <div class="absolute bottom-0 left-0 w-full p-3">
                <h4 class="text-white font-bold text-sm truncate drop-shadow-md">${item.title}</h4>
                <p class="text-gray-300 text-xs truncate">${item.epTitle}</p>
            </div>
        </div>
    </div>`;
}

function renderHome(bannerItems, recentMovies, recentSeries) {
    const c = document.getElementById('home-content');
    c.innerHTML = '';

    if (bannerItems.length > 0) {
        heroItems = bannerItems;
        const heroHtml = `
            <div class="relative w-full h-[70vh] md:h-[85vh] overflow-hidden group">
                <div id="hero-backgrounds" class="absolute inset-0 w-full h-full">
                    ${heroItems.map((m, i) => `
                        <div class="hero-slide absolute inset-0 transition-opacity duration-1000 ease-in-out ${i===0 ? 'opacity-100 z-10' : 'opacity-0 z-0'}">
                            <div class="absolute inset-0 bg-cover bg-center transition-transform duration-[10000ms] ease-linear hover:scale-105" style="background-image: url('${m.thumbnail || m.poster}'); transform: scale(1);"></div>
                            <div class="absolute inset-0 bg-gradient-to-t from-base via-base/60 to-transparent"></div>
                            <div class="absolute inset-0 bg-gradient-to-r from-base/90 via-base/30 to-transparent"></div>
                        </div>
                    `).join('')}
                </div>
                <div class="absolute bottom-0 left-0 w-full p-6 md:p-12 z-30 pb-16 md:pb-24 flex items-end">
                    <div id="hero-metadata" class="max-w-2xl w-full animate-slide-up">
                        ${getHeroContentHtml(heroItems[0])}
                    </div>
                </div>
                <div class="absolute bottom-6 right-6 z-40 flex gap-2">
                    ${heroItems.map((_, i) => `
                        <button onclick="manualSwitchHero(${i})" class="hero-dot w-2 h-2 rounded-full transition-all duration-300 ${i===0 ? 'bg-brand w-6' : 'bg-white/50 hover:bg-white'}"></button>
                    `).join('')}
                </div>
            </div>
        `;
        const bannerContainer = document.getElementById('banner-carousel');
        bannerContainer.innerHTML = heroHtml;
        bannerContainer.className = "relative w-full bg-surface";
        startHeroInterval();
    }

    sb.from('movies').select('*').limit(50).then(({
        data
    }) => {
        if (data && data.length) {
            data.forEach(i => contentCache.set(String(i.id), {
                ...i,
                type: 'movie'
            }));
            const trendingHtml = `
                <div class="mb-8 mt-4 pl-5">
                    <h3 class="text-xl font-bold text-white mb-4 flex items-center gap-2"><i class="ri-fire-fill text-brand"></i> Trending Now</h3>
                    <div class="flex overflow-x-auto gap-4 drag-scroll no-scrollbar pb-4">
                        ${data.slice(0, 10).map((m, i) => createRankCard(m, i+1)).join('')}
                    </div>
                </div>
            `;
            c.insertAdjacentHTML('beforeend', trendingHtml);

            // --- NEW: RECENTLY UPDATED EPISODES SECTION ---
            if (recentSeries && recentSeries.length > 0) {
                const latestEpisodes = recentSeries
                    .map(s => getLatestEpisode(s))
                    .filter(e => e !== null); // Remove series without episodes

                if (latestEpisodes.length > 0) {
                    const epHtml = `
                        <div class="mb-8 pl-5">
                            <h3 class="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                <i class="ri-flashlight-fill text-yellow-500"></i> New Episodes
                            </h3>
                            <div class="flex overflow-x-auto gap-4 drag-scroll no-scrollbar pb-4 pr-5">
                                ${latestEpisodes.map(ep => createLandscapeCard(ep)).join('')}
                            </div>
                        </div>
                    `;
                    c.insertAdjacentHTML('beforeend', epHtml);
                }
            }
            // ----------------------------------------------

            const pillsHtml = `
                <div class="px-5 mb-6 overflow-x-auto no-scrollbar flex gap-3">
                    <button onclick="showPage('categories-page')" class="px-4 py-2 rounded-full bg-white/10 text-white text-xs font-bold border border-white/10 hover:bg-white hover:text-black transition">All Genres</button>
                    ${['Action','Sci-Fi','Drama','Horror','Comedy'].map(g => `
                        <button onclick="quickSearchGenre('${g}')" class="px-4 py-2 rounded-full bg-highlight text-gray-300 text-xs font-bold border border-white/5 hover:border-brand hover:text-white transition">${g}</button>
                    `).join('')}
                </div>
            `;
            c.insertAdjacentHTML('beforeend', pillsHtml);

            if (recentMovies.length) c.appendChild(createRow("New Releases", recentMovies));
            if (popularPeople.length) c.innerHTML += `<div class="mb-8"><h3 class="text-lg font-bold text-white mb-3 px-5">Popular Stars</h3><div class="flex overflow-x-auto gap-4 drag-scroll no-scrollbar px-5 pb-2">${popularPeople.map(p => createCastCircle(p)).join('')}</div></div>`;
            if (recentSeries.length) c.appendChild(createRow("TV Shows", recentSeries));
        }
    });
}

function getHeroContentHtml(m) {
    const match = Math.floor(Math.random() * (99 - 85) + 85);
    return `
        <span class="inline-flex items-center gap-2 bg-black/50 backdrop-blur-md border border-white/20 text-brand text-[10px] font-black px-2 py-1 rounded uppercase mb-3 tracking-widest">
            <i class="ri-netflix-fill"></i> Featured
        </span>
        <h1 class="text-4xl md:text-6xl font-black mb-4 text-white leading-tight drop-shadow-lg fade-in-text">${m.title}</h1>
        <div class="flex items-center gap-4 text-sm text-gray-300 mb-6 font-medium">
            <span class="text-green-400 font-bold">${match}% Match</span>
            <span class="border border-gray-500 px-1 rounded text-xs">${m.year || '2023'}</span>
            <span class="bg-white/20 px-1.5 rounded text-xs text-white">HD</span>
            <span class="flex items-center gap-1 text-yellow-500"><i class="ri-star-fill"></i> ${m.rating || '8.5'}</span>
        </div>
        <p class="text-gray-300 text-sm md:text-base line-clamp-2 md:line-clamp-3 mb-6 max-w-xl drop-shadow-md hidden md:block">
            ${m.description || 'No description available for this title.'}
        </p>
        <div class="flex gap-3">
            <button onclick="openPlayerPage('${String(m.id)}','${m.type||'movie'}')" class="bg-brand text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-red-700 hover:scale-105 transition shadow-lg shadow-brand/20">
                <i class="ri-play-fill text-xl"></i> Play
            </button>
            <button onclick="openPlayerPage('${String(m.id)}','${m.type||'movie'}');" class="bg-white/10 backdrop-blur-md text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-white/20 transition border border-white/10">
                <i class="ri-information-line text-xl"></i> More Info
            </button>
        </div>
    `;
}

function startHeroInterval() {
    if (heroTimer) clearInterval(heroTimer);
    heroTimer = setInterval(() => {
        let nextIndex = (currentHeroIndex + 1) % heroItems.length;
        changeHeroSlide(nextIndex);
    }, 6000);
}

function manualSwitchHero(index) {
    if (index === currentHeroIndex) return;
    clearInterval(heroTimer);
    changeHeroSlide(index);
    startHeroInterval();
}

function changeHeroSlide(index) {
    const slides = document.querySelectorAll('.hero-slide');
    const dots = document.querySelectorAll('.hero-dot');
    const contentContainer = document.getElementById('hero-metadata');
    slides[currentHeroIndex].classList.remove('opacity-100', 'z-10');
    slides[currentHeroIndex].classList.add('opacity-0', 'z-0');
    slides[index].classList.remove('opacity-0', 'z-0');
    slides[index].classList.add('opacity-100', 'z-10');
    dots[currentHeroIndex].classList.remove('bg-brand', 'w-6');
    dots[currentHeroIndex].classList.add('bg-white/50');
    dots[index].classList.remove('bg-white/50');
    dots[index].classList.add('bg-brand', 'w-6');
    contentContainer.style.opacity = '0';
    contentContainer.style.transform = 'translateY(10px)';
    setTimeout(() => {
        contentContainer.innerHTML = getHeroContentHtml(heroItems[index]);
        contentContainer.style.opacity = '1';
        contentContainer.style.transform = 'translateY(0)';
    }, 300);
    currentHeroIndex = index;
}

function quickSearchGenre(gName) {
    const genreMap = {
        'Action': 28,
        'Sci-Fi': 878,
        'Drama': 18,
        'Horror': 27,
        'Comedy': 35
    };
    const id = genreMap[gName];
    if (id) quickLoadGenre(id, gName, 'movie');
}

async function renderGenreGrid() {
    const genres = [{
            id: 28,
            name: 'Action',
            type: 'movie'
        }, {
            id: 12,
            name: 'Adventure',
            type: 'movie'
        },
        {
            id: 16,
            name: 'Animation',
            type: 'movie'
        }, {
            id: 35,
            name: 'Comedy',
            type: 'movie'
        },
        {
            id: 80,
            name: 'Crime',
            type: 'movie'
        }, {
            id: 99,
            name: 'Documentary',
            type: 'movie'
        },
        {
            id: 18,
            name: 'Drama',
            type: 'movie'
        }, {
            id: 10751,
            name: 'Family',
            type: 'movie'
        },
        {
            id: 14,
            name: 'Fantasy',
            type: 'movie'
        }, {
            id: 36,
            name: 'History',
            type: 'movie'
        },
        {
            id: 27,
            name: 'Horror',
            type: 'movie'
        }, {
            id: 10402,
            name: 'Music',
            type: 'movie'
        },
        {
            id: 9648,
            name: 'Mystery',
            type: 'movie'
        }, {
            id: 10749,
            name: 'Romance',
            type: 'movie'
        },
        {
            id: 878,
            name: 'Sci-Fi',
            type: 'movie'
        }, {
            id: 10770,
            name: 'TV Movie',
            type: 'movie'
        },
        {
            id: 53,
            name: 'Thriller',
            type: 'movie'
        }, {
            id: 10752,
            name: 'War',
            type: 'movie'
        },
        {
            id: 37,
            name: 'Western',
            type: 'movie'
        }, {
            id: 10765,
            name: 'Sci-Fi & Fantasy',
            type: 'tv'
        }
    ];
    const container = document.getElementById('genre-grid-container');
    container.innerHTML = genres.map(g => `
        <div id="genre-card-${g.id}" onclick="quickLoadGenre(${g.id}, '${g.name}', '${g.type}')" class="genre-card relative h-28 md:h-36 rounded-xl overflow-hidden cursor-pointer group bg-highlight">
            <div class="absolute inset-0 bg-highlight animate-pulse skeleton-bg"></div>
            <div class="absolute inset-0 bg-black/60 z-10 group-hover:bg-black/50 transition"></div>
            <h3 class="genre-title text-white z-20">${g.name}</h3>
        </div>
    `).join('');
    try {
        const res = await fetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${TMDB_API_KEY}`);
        const data = await res.json();
        const trending = data.results.sort(() => 0.5 - Math.random());
        const genreImages = {};
        trending.forEach(m => {
            if (m.genre_ids && m.backdrop_path) {
                m.genre_ids.forEach(gid => {
                    if (!genreImages[gid]) genreImages[gid] = m.backdrop_path;
                });
            }
        });
        genres.forEach(g => {
            const card = document.getElementById(`genre-card-${g.id}`);
            const bg = genreImages[g.id];
            const skel = card.querySelector('.skeleton-bg');
            if (bg) {
                const img = document.createElement('img');
                img.src = `https://image.tmdb.org/t/p/w780${bg}`;
                img.className = "absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-700 z-0";
                img.onload = () => img.classList.replace('opacity-0', 'opacity-100');
                card.prepend(img);
                if (skel) skel.remove();
            } else {
                if (skel) skel.className = "absolute inset-0 bg-gradient-to-br from-gray-800 to-black z-0";
            }
        });
    } catch (e) {
        console.error("Genre fetch error", e);
    }
}

async function fetchPaginatedContent(type, isLoadMore = false) {
    const state = type === 'movie' ? pageState.movies : pageState.series;
    const container = document.getElementById(type === 'movie' ? 'movies-content' : 'series-content');
    const loader = document.getElementById(type === 'movie' ? 'movies-loader' : 'series-loader');
    const btn = document.getElementById(type === 'movie' ? 'movies-more-btn' : 'series-more-btn');
    if (pageState.isLoading) return;
    pageState.isLoading = true;
    if (!isLoadMore) container.innerHTML = '';
    loader.classList.remove('hidden');
    btn.classList.add('hidden');
    const table = type === 'movie' ? 'movies' : 'series';
    const {
        data,
        error
    } = await sb.from(table).select('*').order('created_at', {
        ascending: false,
        nullsFirst: false
    }).range(state.offset, state.offset + state.limit - 1);
    loader.classList.add('hidden');
    pageState.isLoading = false;
    if (data && data.length > 0) {
        const mapped = data.map(i => {
            const obj = {
                ...i,
                type: type,
                timestamp: new Date(i.created_at).getTime()
            };
            contentCache.set(String(i.id), obj);
            return obj;
        });
        container.insertAdjacentHTML('beforeend', mapped.map(m => createPosterCard(m, false)).join(''));
        state.offset += state.limit;
        if (data.length === state.limit) btn.classList.remove('hidden');
    } else if (!isLoadMore) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 mt-10">No content found in library.</p>';
    }
}

async function fetchTMDBPaginated(isLoadMore = false) {
    const container = document.getElementById(pageState.activePage === 'categories-page' ? 'category-tmdb-results' : 'search-results-tmdb');
    const btn = document.getElementById('category-load-more');
    if (pageState.isLoading) return;
    pageState.isLoading = true;
    if (!isLoadMore) container.innerHTML = '';
    const endpoint = pageState.tmdb.type === 'tv' ? 'discover/tv' : 'discover/movie';
    const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}&with_genres=${pageState.tmdb.genreId}&page=${pageState.tmdb.page}&sort_by=popularity.desc`;
    const res = await fetch(url);
    const data = await res.json();
    pageState.isLoading = false;
    if (data.results && data.results.length > 0) {
        container.insertAdjacentHTML('beforeend', data.results.filter(m => m.poster_path).map(m => {
            m.media_type = pageState.tmdb.type;
            return createTMDBRequestCard(m);
        }).join(''));
        pageState.tmdb.page++;
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

function loadNextPage() {
    if (pageState.activePage === 'movies-page') fetchPaginatedContent('movie', true);
    else if (pageState.activePage === 'series-page') fetchPaginatedContent('series', true);
    else if (pageState.activePage === 'categories-page') fetchTMDBPaginated(true);
}

function showPage(id) {
    if (id === 'mylist-page' && !currentUser) return openAuthModal();
    pageState.activePage = id;

    document.querySelectorAll('.nav-btn').forEach(btn => btn.dataset.page === id ? btn.classList.replace('text-gray-500', 'text-white') : btn.classList.replace('text-white', 'text-gray-500'));

    document.querySelectorAll('.page').forEach(p => {
        if (p.id !== 'player-page') {
            p.classList.remove('active');
            p.style.opacity = 0;
        }
    });
    if (id === 'player-page') document.getElementById('player-page').classList.add('active');
    else {
        document.getElementById('player-page').classList.remove('active');
        const target = document.getElementById(id);
        target.classList.add('active');
        setTimeout(() => target.style.opacity = 1, 50);

        if (window.location.pathname.startsWith('/movie') || window.location.pathname.startsWith('/series')) {
            if (id === 'home-page') updateHistoryState('/');
        }
    }

    window.scrollTo(0, 0);
    document.getElementById('global-search-overlay').classList.remove('open');
    if (id === 'movies-page') {
        pageState.movies.offset = 0;
        renderMoviesHero();
        fetchPaginatedContent('movie');
    } else if (id === 'series-page') {
        pageState.series.offset = 0;
        renderSeriesHero();
        fetchPaginatedContent('series');
    } else if (id === 'categories-page') {
        document.getElementById('category-search-container').classList.add('hidden');
        document.getElementById('genre-header').classList.add('hidden');
        document.getElementById('category-tmdb-results').innerHTML = '';
        document.getElementById('category-load-more').classList.add('hidden');
        renderGenreGrid();
    } else if (id === 'mylist-page') {
        renderMyList();
    }
}

function handleListClick() {
    !currentUser ? openAuthModal() : showPage('mylist-page');
}
document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.dataset.page !== 'mylist-page') b.addEventListener('click', () => showPage(b.dataset.page));
});

async function renderMyList() {
    if (!userFavorites.length) {
        document.getElementById('mylist-grid').innerHTML = '<p class="col-span-full text-center text-gray-500">Your list is empty.</p>';
        return;
    }
    document.getElementById('mylist-count').textContent = userFavorites.length;
    const missingIds = userFavorites.map(String).filter(id => !contentCache.has(id));
    if (missingIds.length > 0) {
        const {
            data: movies
        } = await sb.from('movies').select('*').in('id', missingIds);
        const {
            data: series
        } = await sb.from('series').select('*').in('id', missingIds);
        [...(movies || []), ...(series || [])].forEach(i => contentCache.set(String(i.id), {
            ...i,
            type: i.seasons ? 'series' : 'movie'
        }));
    }
    const favItems = userFavorites.map(id => contentCache.get(String(id))).filter(Boolean);
    document.getElementById('mylist-grid').innerHTML = favItems.map(m => createPosterCard(m, false)).join('');
}

function quickLoadGenre(id, name, type) {
    showPage('categories-page');
    loadGenreContent(id, name, type);
    setTimeout(() => {
        document.getElementById('category-search-container').scrollIntoView({
            behavior: 'smooth'
        });
    }, 300);
}

function loadGenreContent(genreId, genreName, genreType) {
    document.getElementById('selected-genre-title').innerText = genreName;
    document.getElementById('genre-header').classList.remove('hidden');
    document.getElementById('category-search-container').classList.remove('hidden');
    pageState.tmdb = {
        page: 1,
        genreId: genreId,
        type: genreType
    };
    fetchTMDBPaginated(false);
}

function toggleSearchOverlay() {
    const overlay = document.getElementById('global-search-overlay');
    overlay.classList.toggle('open');
    if (overlay.classList.contains('open')) {
        document.getElementById('global-search-input').focus();
    }
}
let searchDebounce;
document.getElementById('global-search-input').addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    clearTimeout(searchDebounce);
    const localSec = document.getElementById('search-section-local'),
        tmdbSec = document.getElementById('search-section-tmdb'),
        loader = document.getElementById('search-loader');
    if (query.length < 2) {
        localSec.classList.add('hidden');
        tmdbSec.classList.add('hidden');
        return;
    }
    loader.classList.remove('hidden');
    searchDebounce = setTimeout(async () => {
        const {
            data: movies
        } = await sb.from('movies').select('*').ilike('title', `%${query}%`).limit(10);
        const {
            data: series
        } = await sb.from('series').select('*').ilike('title', `%${query}%`).limit(10);
        const dbResults = [...(movies || []).map(m => ({
            ...m,
            type: 'movie'
        })), ...(series || []).map(s => ({
            ...s,
            type: 'series'
        }))];
        dbResults.forEach(i => contentCache.set(String(i.id), i));
        loader.classList.add('hidden');
        if (dbResults.length > 0) {
            localSec.classList.remove('hidden');
            document.getElementById('search-results-local').innerHTML = dbResults.map(m => createPosterCard(m, false)).join('');
        } else {
            localSec.classList.add('hidden');
        }
        tmdbSec.classList.remove('hidden');
        fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`).then(res => res.json()).then(data => {
            const validResults = data.results.filter(item => (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path);
            document.getElementById('search-results-tmdb').innerHTML = validResults.length ? validResults.map(m => createTMDBRequestCard(m)).join('') : `<p class="col-span-full text-gray-500 text-center text-sm">No matches found on TMDB.</p>`;
        });
    }, 600);
});

async function openPlayerPage(id, type, preventHistoryUpdate = false) {
    const safeId = String(id);
    let item = contentCache.get(safeId);
    if (!item || !item.description) {
        const table = type === 'movie' ? 'movies' : 'series';
        const {
            data,
            error
        } = await sb.from(table).select('*').eq('id', safeId).single();
        if (data) {
            item = {
                ...data,
                type: type
            };
            contentCache.set(safeId, item);
        } else {
            return showNotification("Content not found", "error");
        }
    }
    currentOpenId = safeId;
    currentSeriesData = item;
    activeServerList = [];
    activeServerIndex = 0;

    if (!preventHistoryUpdate) {
        const slug = createSlug(item.title);
        const newUrl = type === 'movie' ?
            `/movie/${item.id}/${slug}` :
            `/series/${item.id}/${slug}`;
        updateHistoryState(newUrl);
    }

    let history = JSON.parse(localStorage.getItem('watchHistory')) || [];
    history = history.filter(i => String(i.id) !== safeId);
    history.unshift({
        id: item.id,
        type: item.type,
        title: item.title,
        poster: item.thumbnail || item.poster,
        timestamp: Date.now()
    });
    if (history.length > 10) history.pop();
    localStorage.setItem('watchHistory', JSON.stringify(history));

    const isSeries = item.type === 'series';
    const isFav = userFavorites.map(String).includes(safeId);
    const qualityTag = item.quality || 'HD';
    const qualityColor = qualityTag === '4K' ? 'text-brand border-brand' : 'text-gray-300 border-gray-500';

    document.getElementById('player-meta').innerHTML = `<h1 class="text-2xl md:text-4xl font-black text-white mb-2">${item.title}</h1><div class="flex items-center gap-3 text-sm text-gray-400 mb-4"><span class="text-green-500 font-bold">98% Match</span>${isSeries ? '<span class="bg-highlight border border-white/10 px-2 py-0.5 rounded text-xs text-white">SERIES</span>' : `<span class="border ${qualityColor} px-1.5 rounded text-xs font-bold">${qualityTag}</span>`}<span class="text-gray-500 text-xs">${item.year || ''}</span><button onclick="reportIssue('${item.id}', '${item.title}')" class="flex items-center gap-1 hover:text-white transition bg-highlight px-3 py-1 rounded-full border border-white/10 ml-2"><i class="ri-flag-fill text-yellow-500 text-lg"></i></button><button id="fav-btn" onclick="toggleFavorite('${item.id}')" class="flex items-center gap-1 ${isFav?'text-brand':''} hover:text-white transition ml-auto bg-highlight px-3 py-1 rounded-full"><i id="fav-icon" class="${isFav?'ri-check-line':'ri-add-line'} text-lg"></i></button></div><p class="text-gray-300 text-sm leading-relaxed mb-4">${item.description||'No description available.'}</p><div class="text-xs text-gray-500">Genre: <span class="text-gray-300">${item.genre}</span></div>`;

    // Removed Cast Section Logic (Overview)

    const dl = document.getElementById('downloads-list');
    if (!isSeries && item.downloads) dl.innerHTML = item.downloads.map(d => `<a href="${d.link}" target="_blank" class="flex items-center justify-between p-4 bg-highlight/30 rounded-lg border border-white/5 hover:bg-highlight/50 hover:border-brand transition group"><div><div class="font-bold text-white text-sm group-hover:text-brand">Download ${d.title}</div><div class="text-[10px] text-gray-500">Server Link</div></div><i class="ri-download-cloud-2-line text-xl text-gray-400 group-hover:text-white"></i></a>`).join('');
    else dl.innerHTML = isSeries ? `<div class="text-center text-gray-500 text-sm py-4">Downloads available via Episodes tab</div>` : `<div class="text-center text-gray-500 text-sm py-4">No downloads available</div>`;

    const et = document.getElementById('tab-episodes'),
        ss = document.getElementById('season-select');
    document.getElementById('video-area').innerHTML = `<div class="video-wrapper relative"><div id="player-placeholder" class="absolute inset-0 w-full h-full"><img src="${item.thumbnail||item.poster}" class="w-full h-full object-cover opacity-60"><div class="absolute inset-0 flex items-center justify-center"><div class="w-20 h-20 bg-brand rounded-full flex items-center justify-center text-white shadow-[0_0_40px_rgba(229,9,20,0.6)]"><i class="ri-play-fill text-4xl ml-1"></i></div></div></div></div>`;
    document.getElementById('server-trigger-bar').classList.add('hidden');

    // Setup Similar Content (Load from DB)
    const primaryGenre = item.genre ? item.genre.split(',')[0].trim() : '';
    pageState.similar = {
        offset: 0,
        limit: 20,
        genre: primaryGenre,
        type: item.type,
        excludeId: item.id
    };
    document.getElementById('similar-grid').innerHTML = '';
    document.getElementById('similar-load-more-btn').classList.add('hidden');
    fetchSimilarContent();

    if (isSeries) {
        et.classList.remove('hidden');
        const seasonContainer = document.getElementById('season-selector-container');
        let firstEp = null;

        if (item.seasons && item.seasons.length > 0) {
            seasonContainer.classList.remove('hidden');
            ss.innerHTML = item.seasons.map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
            renderEpisodes(0);
            if (item.seasons[0].episodes && item.seasons[0].episodes.length > 0) firstEp = item.seasons[0].episodes[0];
        } else if (item.episodes && item.episodes.length > 0) {
            seasonContainer.classList.remove('hidden');
            ss.innerHTML = `<option value="flat">Season 1</option>`;
            renderEpisodes('flat');
            firstEp = item.episodes[0];
        } else {
            seasonContainer.classList.add('hidden');
            document.getElementById('episodes-list').innerHTML = '<div class="text-gray-500 text-center py-4">No episodes available</div>';
        }

        switchTab('episodes');
        if (firstEp && !preventHistoryUpdate) {
            let epServers = firstEp.servers || [];
            if ((!epServers || epServers.length === 0) && firstEp.link) epServers = [{
                name: "Server 1",
                url: firstEp.link
            }];
            const epData = {
                title: firstEp.title || `Episode 1`,
                servers: epServers,
                downloadLink: firstEp.downloadLink
            };
            playEpisode(encodeURIComponent(JSON.stringify(epData)), 0);
        }
    } else {
        document.getElementById('season-selector-container').classList.add('hidden');
        et.classList.add('hidden');
        if (item.servers && Array.isArray(item.servers) && item.servers.length > 0) activeServerList = item.servers;
        else if (item.watchLink) activeServerList = [{
            name: "Server 1",
            url: item.watchLink
        }];
        else if (item.link) activeServerList = [{
            name: "Server 1",
            url: item.link
        }];

        if (activeServerList.length > 0) {
            document.getElementById('server-trigger-bar').classList.remove('hidden');
            selectServerFromModal(0);
        } else document.getElementById('current-server-name').innerText = "No Servers";

        // Changed from 'overview' to 'similar'
        switchTab('similar');
    }
    loadComments(safeId);
    showPage('player-page');
}

async function fetchSimilarContent(isLoadMore = false) {
    if (pageState.isLoading) return;
    pageState.isLoading = true;
    const loader = document.getElementById('similar-loader');
    const btn = document.getElementById('similar-load-more-btn');
    const container = document.getElementById('similar-grid');
    if (!isLoadMore) container.innerHTML = '';
    loader.classList.remove('hidden');
    btn.classList.add('hidden');
    const table = pageState.similar.type === 'movie' ? 'movies' : 'series';

    // Logic to load data from DB
    let query = sb.from(table).select('*');
    if (pageState.similar.genre) {
        query = query.ilike('genre', `%${pageState.similar.genre}%`);
    }
    const {
        data,
        error
    } = await query
        .neq('id', pageState.similar.excludeId)
        .order('created_at', {
            ascending: false,
            nullsFirst: false
        })
        .range(pageState.similar.offset, pageState.similar.offset + pageState.similar.limit - 1);

    loader.classList.add('hidden');
    pageState.isLoading = false;
    if (data && data.length > 0) {
        const mapped = data.map(i => {
            const obj = {
                ...i,
                type: pageState.similar.type,
                timestamp: new Date(i.created_at).getTime()
            };
            contentCache.set(String(i.id), obj);
            return obj;
        });
        container.insertAdjacentHTML('beforeend', mapped.map(m => createPosterCard(m, false)).join(''));
        pageState.similar.offset += pageState.similar.limit;
        if (data.length === pageState.similar.limit) btn.classList.remove('hidden');
    } else if (!isLoadMore && pageState.similar.offset === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-500 py-10">No similar content found.</p>';
    }
}

function loadNextSimilarPage() {
    fetchSimilarContent(true);
}

function createPosterCard(m, isLandscape) {
    return `<div onclick="openPlayerPage('${m.id}','${m.type}')" class="cursor-pointer transition hover:scale-105 duration-300 relative group animate-fade-in"><div class="${isLandscape ? 'aspect-video' : 'aspect-[2/3]'} rounded-lg overflow-hidden bg-surface border border-white/10 relative"><img src="${m.poster}" class="w-full h-full object-cover" loading="lazy">${m.type==='series'?'<span class="absolute top-1 right-1 bg-black/60 text-[9px] text-white px-1 rounded font-bold tracking-wider">TV</span>':''}</div><h4 class="text-xs font-medium mt-2 truncate text-gray-400 group-hover:text-white">${m.title}</h4></div>`;
}

function createRankCard(m, rank) {
    return `<div onclick="openPlayerPage('${m.id}','${m.type}')" class="flex-none w-36 md:w-44 cursor-pointer relative group pl-5"><div class="aspect-[2/3] rounded-lg overflow-hidden border border-white/10 rank-card-image transition hover:scale-105 duration-300"><img src="${m.poster}" class="w-full h-full object-cover"></div><div class="rank-number">${rank}</div></div>`;
}

function createCastCircle(person) {
    return `<div onclick="toggleSearchOverlay(); document.getElementById('global-search-input').value = '${person.name}'; document.getElementById('global-search-input').dispatchEvent(new Event('input'));" class="flex-none w-20 flex flex-col items-center gap-2 cursor-pointer group"><div class="w-16 h-16 rounded-full overflow-hidden border-2 border-white/10 group-hover:border-brand transition"><img src="https://image.tmdb.org/t/p/w185${person.profile_path}" class="w-full h-full object-cover"></div><p class="text-[10px] text-center text-gray-400 group-hover:text-white truncate w-full">${person.name}</p></div>`;
}

function createRow(title, items) {
    const div = document.createElement('div');
    div.innerHTML = `<div class="flex justify-between items-end mb-4 px-5"><h3 class="text-lg font-bold text-white capitalize">${title}</h3></div><div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 px-5 pb-4">${items.map(m => `<div onclick="openPlayerPage('${m.id}','${m.type}')" class="cursor-pointer group relative transition hover:scale-105 duration-300"><div class="aspect-[2/3] rounded-lg overflow-hidden bg-surface shadow-lg border border-white/5"><img src="${m.poster}" class="w-full h-full object-cover" loading="lazy"></div><h4 class="text-xs font-medium mt-2 truncate text-gray-400 group-hover:text-white">${m.title}</h4></div>`).join('')}</div>`;
    return div;
}

function createTMDBRequestCard(item) {
    const title = item.title || item.name;
    const existing = Array.from(contentCache.values()).find(c => c.title.toLowerCase() === title.toLowerCase());
    const itemData = JSON.stringify({
        ...item,
        media_type: item.media_type || 'movie'
    }).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
    if (existing) return createPosterCard(existing, false);
    return `<div class="relative group cursor-pointer rounded-lg overflow-hidden border border-white/10 aspect-[2/3]"><img src="https://image.tmdb.org/t/p/w342${item.poster_path}" class="w-full h-full object-cover"><button onclick='openRequestModal(${itemData})' class="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/80"><div class="w-12 h-12 rounded-full bg-highlight flex items-center justify-center mb-2 text-brand"><i class="ri-send-plane-fill text-xl"></i></div><span class="text-[10px] font-bold text-white uppercase">Request</span></button><div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black p-2"><p class="text-[10px] text-gray-300 truncate">${title}</p></div></div>`;
}

function setupAuthListener() {
    sb.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;
        if (currentUser) {
            closeAuthModal();
            document.getElementById('auth-view-guest').classList.add('hidden');
            document.getElementById('auth-view-user').classList.remove('hidden');
            document.getElementById('user-email-display').textContent = currentUser.email;
            document.getElementById('user-icon').classList.add('hidden');
            document.getElementById('user-avatar').src = `https://ui-avatars.com/api/?name=${currentUser.email}&background=E50914&color=fff`;
            document.getElementById('user-avatar').classList.remove('hidden');
            fetchUserProfile();
        } else {
            userFavorites = [];
            document.getElementById('user-avatar').classList.add('hidden');
            document.getElementById('user-icon').classList.remove('hidden');
            document.getElementById('auth-view-guest').classList.remove('hidden');
            document.getElementById('auth-view-user').classList.add('hidden');
            document.getElementById('mylist-count').textContent = 0;
        }
    });
    sb.auth.getSession().then(({
        data: {
            session
        }
    }) => {
        if (session?.user) {
            currentUser = session.user;
            fetchUserProfile();
        }
    });
}

function fetchUserProfile() {
    if (!currentUser) return;
    sb.from('profiles').select('favorites').eq('id', currentUser.id).single().then(({
        data
    }) => {
        if (data && data.favorites) {
            userFavorites = data.favorites;
            document.getElementById('mylist-count').textContent = userFavorites.length;
        } else {
            userFavorites = [];
        }
    });
}
async function handleSignOut() {
    await sb.auth.signOut();
    window.location.reload();
}
let pendingRequestItem = null;

function openRequestModal(item) {
    if (!currentUser) {
        showNotification("Login to request", "error");
        return openAuthModal();
    }
    pendingRequestItem = item;
    document.getElementById('confirm-modal-text').innerHTML = `You are about to request <b>"${item.title || item.name}"</b>.`;
    document.getElementById('custom-confirm-modal').classList.remove('hidden');
}

function closeConfirmModal() {
    document.getElementById('custom-confirm-modal').classList.add('hidden');
    pendingRequestItem = null;
}

document.getElementById('confirm-action-btn').addEventListener('click', () => {
    if (!pendingRequestItem || !currentUser) return;
    const item = pendingRequestItem;
    sb.from('requests').insert({
        tmdb_id: String(item.id),
        title: item.title || item.name,
        type: item.media_type === 'tv' ? 'Series' : 'Movie',
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
        requested_by: currentUser.email,
        status: 'pending'
    }).then(({
        error
    }) => {
        if (error) {
            if (error.message.includes('Rate limit') || error.message.includes('already requested')) {
                showNotification(error.message, "error");
            } else {
                showNotification("Error sending request.", "error");
            }
        } else {
            showNotification("Request Received!", "success");
        }
        closeConfirmModal();
    });
});

async function reportIssue(id, title) {
    if (!currentUser) {
        showNotification("Login to report issues", "error");
        return openAuthModal();
    }
    if (confirm(`Report playback issue for "${title}"?`)) {
        const {
            error
        } = await sb.from('reports').insert({
            content_id: id,
            title: title,
            type: 'Dead Link',
            requested_by: currentUser.email
        });
        if (error) showNotification("Error sending report", "error");
        else showNotification("Report sent! We'll fix it soon.", "success");
    }
}

function openLegalModal(type) {
    const texts = {
        dmca: `<h3>DMCA Notice</h3><p>MultiFlix respects intellectual property rights. We comply with the Digital Millennium Copyright Act (DMCA).</p><p>If you believe that your work has been copied in a way that constitutes copyright infringement, please notify us.</p>`,
        privacy: `<h3>Privacy Policy</h3><p>Your privacy is important to us. We only collect information to provide our services.</p>`
    };
    document.getElementById('legal-modal-title').innerText = type === 'dmca' ? 'DMCA' : 'Privacy Policy';
    document.getElementById('legal-modal-body').innerHTML = texts[type];
    document.getElementById('legal-modal').classList.remove('hidden');
}

function closeLegalModal() {
    document.getElementById('legal-modal').classList.add('hidden');
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    let bgClass = "bg-highlight",
        icon = "ri-notification-3-line";
    if (type === 'success') {
        bgClass = "bg-green-900/90 border-green-500";
        icon = "ri-check-double-line";
    }
    if (type === 'error') {
        bgClass = "bg-red-900/90 border-red-500";
        icon = "ri-error-warning-line";
    }
    const toast = document.createElement('div');
    toast.className = `pointer-events-auto w-72 p-4 rounded-xl border ${bgClass} text-white shadow-2xl backdrop-blur-md toast-enter flex items-start gap-3`;
    toast.innerHTML = `<div class="mt-1"><i class="${icon} text-xl"></i></div><div class="flex-1"><h4 class="text-sm font-bold mb-1">Notification</h4><p class="text-xs text-gray-200 leading-snug">${message}</p></div>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 500);
    }, 5000);
}

function renderMoviesHero() {
    if (contentCache.size > 0) {
        const m = Array.from(contentCache.values()).find(x => x.type === 'movie');
        if (m) {
            document.getElementById('movies-hero-img').src = m.thumbnail || m.poster;
            document.getElementById('movies-hero-img').onload = function() {
                this.style.opacity = 1;
                document.querySelector('#movies-banner .skeleton').style.display = 'none';
            };
        }
    }
}

function renderSeriesHero() {
    if (contentCache.size > 0) {
        const s = Array.from(contentCache.values()).find(x => x.type === 'series');
        if (s) {
            document.getElementById('series-hero-img').src = s.thumbnail || s.poster;
            document.getElementById('series-hero-img').onload = function() {
                this.style.opacity = 1;
                document.querySelector('#series-banner .skeleton').style.display = 'none';
            };
        }
    }
}

function renderEpisodes(idx) {
    const item = currentSeriesData;
    if (!item) return;

    let eps = [];

    if (idx === 'flat' || !item.seasons || item.seasons.length === 0) {
        eps = item.episodes || [];
    } else {
        const seasonIndex = parseInt(idx);
        if (item.seasons[seasonIndex]) {
            eps = item.seasons[seasonIndex].episodes;
        }
    }

    if (!eps || eps.length === 0) {
        document.getElementById('episodes-list').innerHTML = '<div class="text-center text-gray-500 py-4">No episodes found for this selection.</div>';
        return;
    }

    document.getElementById('episodes-list').innerHTML = eps.map((ep, i) => {
        let epServers = [];

        const hasDirectLink = ep.link && typeof ep.link === 'string' && ep.link.trim() !== "";
        const hasServerArray = ep.servers && Array.isArray(ep.servers) && ep.servers.length > 0;

        if (hasServerArray) epServers = ep.servers;
        else if (hasDirectLink) epServers = [{
            name: "Server 1",
            url: ep.link
        }];

        const isAvailable = hasDirectLink || hasServerArray;

        const epData = {
            title: ep.title || `Episode ${i+1}`,
            servers: epServers,
            downloadLink: ep.downloadLink
        };
        const encodedData = encodeURIComponent(JSON.stringify(epData));
        const epThumb = ep.still || item.thumbnail || item.poster;

        let lockedClass = "";
        let clickAction = "";

        if (isAvailable) {
            lockedClass = "";
            clickAction = `playEpisode('${encodedData}', ${i})`;
        } else {
            lockedClass = "locked";
            clickAction = `showNotification('Coming soon, be patient', 'error')`;
        }

        return `
            <div id="ep-card-${i}" class="ep-card-container group ${lockedClass}" onclick="${clickAction}">
                <div class="ep-thumb-wrapper">
                    <img src="${epThumb}" loading="lazy">
                </div>
                <div class="ep-info">
                    <div class="ep-title-row">
                        <span class="ep-number">${i+1}.</span>
                        <span class="ep-title">${ep.title || `Episode ${i+1}`}</span>
                    </div>
                    <p class="ep-desc">${ep.overview || item.title + ' Episode ' + (i+1)}</p>
                </div>
            </div>
        `;
    }).join('');
}

function playEpisode(encodedEpData, index, preventHistoryUpdate = false) {
    try {
        const epData = JSON.parse(decodeURIComponent(encodedEpData));
        activeServerList = epData.servers || [];
        activeServerIndex = 0;

        document.querySelectorAll('.ep-card-container').forEach(c => {
            c.style.background = 'transparent';
        });

        const active = document.getElementById(`ep-card-${index}`);
        if (active) {
            active.style.background = 'rgba(255,255,255,0.1)';
        }

        if (activeServerList.length > 0) {
            document.getElementById('server-trigger-bar').classList.remove('hidden');
            selectServerFromModal(0);
        } else {
            document.getElementById('server-trigger-bar').classList.add('hidden');
            showNotification("No sources available for this episode.", "error");
        }
        window.scrollTo(0, 0);

        if (currentSeriesData && !preventHistoryUpdate) {
            let seasonIndex = 1;
            const selectVal = document.getElementById('season-select').value;

            if (selectVal !== 'flat') {
                seasonIndex = parseInt(selectVal) + 1;
            }

            const episodeIndex = index + 1;
            const slug = createSlug(currentSeriesData.title);
            const epUrl = `/series/${currentSeriesData.id}/${slug}/season/${seasonIndex}/episode/${episodeIndex}`;
            updateHistoryState(epUrl);
        }

    } catch (e) {
        console.error("Error playing episode", e);
    }
}

function openServerModal() {
    if (!activeServerList || activeServerList.length === 0) return;
    document.getElementById('server-list-container').innerHTML = activeServerList.map((srv, index) => `<div onclick="selectServerFromModal(${index})" class="server-item ${index === activeServerIndex ? 'active' : ''}"><span class="server-name">${srv.name || 'Server '+(index+1)}</span><i class="ri-check-line check-icon"></i></div>`).join('');
    document.getElementById('server-modal').classList.remove('hidden');
}

function closeServerModal() {
    document.getElementById('server-modal').classList.add('hidden');
}

function selectServerFromModal(index) {
    if (!activeServerList[index]) return;
    activeServerIndex = index;
    document.getElementById('current-server-name').innerText = activeServerList[index].name || `Server ${index + 1}`;
    injectVideo(activeServerList[index].url);
    closeServerModal();
}

function injectVideo(link) {
    if (!link) return showNotification("Link unavailable.", "error");
    let f = link;
    if (link.includes('youtube.com') || link.includes('youtu.be')) {
        const vidId = link.includes('v=') ? link.split('v=')[1].split('&')[0] : link.split('youtu.be/')[1];
        f = `https://www.youtube.com/embed/${vidId}?autoplay=1`;
    }
    const wrapper = document.querySelector('.video-wrapper');
    if (wrapper) wrapper.innerHTML = `<iframe src="${f}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay"></iframe>`;
    else document.getElementById('video-area').innerHTML = `<div class="video-wrapper relative"><iframe src="${f}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; encrypted-media"></iframe></div>`;
}

function closePlayerPage() {
    document.getElementById('video-area').innerHTML = '';
    updateHistoryState('/');
    showPage('home-page');
}

function switchTab(t) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active', 'text-white'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${t}`).classList.add('active', 'text-white');
    document.getElementById(`content-${t}`).classList.remove('hidden');
}

function toggleFavorite(id) {
    if (!currentUser) return openAuthModal();
    const sId = String(id);
    const isNowFav = !userFavorites.map(String).includes(sId);
    let newFavs = [...userFavorites];
    if (isNowFav) {
        newFavs.push(sId);
        showNotification("Added to My List", "success");
    } else {
        newFavs = newFavs.filter(fav => String(fav) !== sId);
        showNotification("Removed from My List", "info");
    }
    userFavorites = newFavs;
    document.getElementById('mylist-count').textContent = userFavorites.length;
    const btn = document.getElementById('fav-btn');
    const icon = document.getElementById('fav-icon');
    if (btn && icon) {
        if (isNowFav) {
            btn.classList.add('text-brand');
            icon.className = 'ri-check-line text-lg';
        } else {
            btn.classList.remove('text-brand');
            icon.className = 'ri-add-line text-lg';
        }
    }
    sb.from('profiles').update({
        favorites: newFavs
    }).eq('id', currentUser.id).then(({
        error
    }) => {
        if (error) console.error("Error updating favorites", error);
    });
}

function loadComments(id) {
    sb.from('comments').select('*').eq('content_id', id).order('created_at', {
        ascending: false
    }).limit(20).then(({
        data,
        error
    }) => {
        if (data && data.length > 0) {
            document.getElementById('comments-list').innerHTML = data.map(c => {
                const userName = c.user_email.split('@')[0];
                return `<div class="flex gap-3"><div class="w-8 h-8 rounded-full bg-highlight flex items-center justify-center text-brand font-bold border border-white/10 uppercase">${userName[0]}</div><div><div class="text-xs text-gray-500">${userName} &bull; ${c.created_at ? dayjs(c.created_at).fromNow() : 'Just now'}</div><div class="text-sm text-gray-300">${c.text}</div></div></div>`;
            }).join('');
        } else {
            document.getElementById('comments-list').innerHTML = '<div class="text-center text-gray-600 text-sm">No comments yet.</div>';
        }
    });
}

function postComment() {
    const t = document.getElementById('comment-input').value.trim();
    if (!currentUser) return openAuthModal();
    if (t) {
        sb.from('comments').insert({
            content_id: currentOpenId,
            user_email: currentUser.email,
            text: t
        }).then(({
            error
        }) => {
            if (!error) {
                document.getElementById('comment-input').value = '';
                loadComments(currentOpenId);
            }
        });
    }
}

function openAuthModal() {
    document.getElementById('auth-modal').classList.remove('hidden');
}

function closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
}
document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    sb.auth.signInWithPassword({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
    }).then(({
        data,
        error
    }) => {
        if (error) document.getElementById('auth-error').textContent = error.message;
    });
});
document.getElementById('signup-form').addEventListener('submit', e => {
    e.preventDefault();
    sb.auth.signUp({
        email: document.getElementById('signup-email').value,
        password: document.getElementById('signup-password').value
    }).then(({
        data,
        error
    }) => {
        if (error) document.getElementById('auth-error').textContent = error.message;
        else if (data.user) {}
    });
});
document.getElementById('show-signup-btn').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('signup-container').classList.remove('hidden');
});
document.getElementById('show-login-btn').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('signup-container').classList.add('hidden');
    document.getElementById('login-container').classList.remove('hidden');
});

initApp();