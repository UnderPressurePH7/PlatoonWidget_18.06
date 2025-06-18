import EventEmitter from '../battle-history/scripts/eventEmitter.js';
import { GAME_POINTS, STATS } from '../battle-history/scripts/constants.js';

class CoreService {
  constructor() {
    this.CONFIG = {
      SERVER_TIMEOUT: 5000,
      RETRY_ATTEMPTS: 2,
      DEBOUNCE_DELAY: 1000,
      SAVE_DELAY: 250,
      MIN_RANDOM_DELAY: 10,
      MAX_RANDOM_DELAY: 50
    };

    this.initializeSDK();
    this.initializeState();
    this.setupSDKListeners();
    this.eventsCore = new EventEmitter();
    this.pendingOperations = new Set();
    this.debounceServerUpdate = this.debounce(() => this.serverData(), this.CONFIG.DEBOUNCE_DELAY);
    this.loadFromServer().catch(console.error);
  }

  initializeSDK() {
    try {
      this.sdk = new WotstatWidgetsSdk.WidgetSDK();
    } catch (error) {
      console.error('Failed to initialize SDK:', error);
      throw error;
    }
  }

  initializeState() {
    const savedState = this.loadLocalState();
    if (savedState) {
      Object.assign(this, savedState);
    } else {
      this.resetState();
    }
  }

  loadLocalState() {
    try {
      const savedState = localStorage.getItem('gameState');
      return savedState ? JSON.parse(savedState) : null;
    } catch (error) {
      console.error('Failed to load local state:', error);
      return null;
    }
  }

  resetState() {
    this.BattleStats = {};
    this.PlayersInfo = {};
    this.curentPlayerId = this.sdk.data.player.id.value;
    this.curentArenaId = null;
    this.curentVehicle = null;
    this.isInPlatoon = false;
  }

  debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getRandomDelay() {
    const delay = Math.floor(Math.random() * (this.CONFIG.MAX_RANDOM_DELAY - this.CONFIG.MIN_RANDOM_DELAY + 5)) + this.CONFIG.MIN_RANDOM_DELAY;
    return this.sleep(delay);
  }

  setupSDKListeners() {
    const listeners = [
      [this.sdk.data.hangar.isInHangar, this.handleHangarStatus],
      [this.sdk.data.hangar.vehicle.info, this.handleHangarVehicle],
      [this.sdk.data.platoon.isInPlatoon, this.handlePlatoonStatus],
      [this.sdk.data.battle.arena, this.handleArena],
      [this.sdk.data.battle.onDamage, this.handleOnAnyDamage],
      [this.sdk.data.battle.onPlayerFeedback, this.handlePlayerFeedback],
      [this.sdk.data.battle.onBattleResult, this.handleBattleResult]
    ];

    listeners.forEach(([observable, handler]) => {
      observable.watch(handler.bind(this));
    });
  }

  saveState() {
    try {
      const state = {
        BattleStats: this.BattleStats,
        PlayersInfo: this.PlayersInfo,
        curentPlayerId: this.curentPlayerId,
        curentArenaId: this.curentArenaId,
        curentVehicle: this.curentVehicle,
        isInPlatoon: this.isInPlatoon
      };
      localStorage.setItem('gameState', JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }

  clearState() {
    localStorage.removeItem('gameState');
    this.resetState();
  }

  initializeBattleStats(arenaId, playerId) {
    if (!this.BattleStats[arenaId]) {
      this.BattleStats[arenaId] = {
        startTime: Date.now(),
        duration: 0,
        win: -1,
        mapName: 'Unknown Map',
        players: {}
      };
    }

    if (!this.BattleStats[arenaId].players[playerId]) {
      this.BattleStats[arenaId].players[playerId] = {
        name: this.PlayersInfo[playerId] || 'Unknown Player',
        damage: 0,
        kills: 0,
        points: 0,
        vehicle: this.curentVehicle || 'Unknown Vehicle'
      };
    }
  }

  getPlayer(id) {
    return this.PlayersInfo[id] || null;
  }

  getPlayersIds() {
    return Object.keys(this.PlayersInfo || {})
      .filter(key => !isNaN(key))
      .map(Number);
  }

  isExistsPlayerRecord() {
    return this.getPlayersIds().includes(this.curentPlayerId);
  }

  findBestAndWorstBattle() {
    const completedBattles = Object.entries(this.BattleStats)
      .map(([arenaId, battle]) => ({ id: arenaId, ...battle }))
      .filter(battle => battle.win !== -1);

    if (completedBattles.length === 0) {
      return { bestBattle: null, worstBattle: null };
    }

    let bestBattle = completedBattles[0];
    let worstBattle = completedBattles[0];
    let bestPoints = this.calculateBattlePoints(bestBattle);
    let worstPoints = bestPoints;

    completedBattles.forEach(battle => {
      const points = this.calculateBattlePoints(battle);
      if (points > bestPoints) {
        bestBattle = battle;
        bestPoints = points;
      }
      if (points < worstPoints) {
        worstBattle = battle;
        worstPoints = points;
      }
    });

    return {
      bestBattle: { battle: bestBattle, points: bestPoints },
      worstBattle: { battle: worstBattle, points: worstPoints }
    };
  }

  calculateBattlePoints(battle) {
    let points = battle.win === 1 ? GAME_POINTS.POINTS_PER_TEAM_WIN : 0;
    
    if (battle.players) {
      points += Object.values(battle.players).reduce((sum, player) => sum + (player.points || 0), 0);
    }
    
    return points;
  }

  calculateBattleData(arenaId = this.curentArenaId) {
    if (!this.BattleStats[arenaId]?.players) {
      return { battlePoints: 0, battleDamage: 0, battleKills: 0 };
    }

    return Object.values(this.BattleStats[arenaId].players).reduce((acc, player) => ({
      battlePoints: acc.battlePoints + (player.points || 0),
      battleDamage: acc.battleDamage + (player.damage || 0),
      battleKills: acc.battleKills + (player.kills || 0)
    }), { battlePoints: 0, battleDamage: 0, battleKills: 0 });
  }

  calculatePlayerData(playerId) {
    return Object.values(this.BattleStats).reduce((acc, battle) => {
      const player = battle.players?.[playerId];
      if (player) {
        acc.playerPoints += player.points || 0;
        acc.playerDamage += player.damage || 0;
        acc.playerKills += player.kills || 0;
      }
      return acc;
    }, { playerPoints: 0, playerDamage: 0, playerKills: 0 });
  }

  calculateTeamData() {
    return Object.values(this.BattleStats).reduce((acc, battle) => {
      acc.battles++;
      if (battle.win === 1) {
        acc.teamPoints += GAME_POINTS.POINTS_PER_TEAM_WIN;
        acc.wins++;
      }

      Object.values(battle.players || {}).forEach(player => {
        acc.teamPoints += player.points || 0;
        acc.teamDamage += player.damage || 0;
        acc.teamKills += player.kills || 0;
      });

      return acc;
    }, { teamPoints: 0, teamDamage: 0, teamKills: 0, wins: 0, battles: 0 });
  }

  getAccessKey() {
    return localStorage.getItem('accessKey');
  }

  async makeRequest(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.CONFIG.SERVER_TIMEOUT);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async saveToServer(retries = this.CONFIG.RETRY_ATTEMPTS) {
    const accessKey = this.getAccessKey();
    if (!accessKey) throw new Error('Access key not found');

    const operationId = `save-${Date.now()}`;
    if (this.pendingOperations.has(operationId)) return false;
    
    this.pendingOperations.add(operationId);

    try {
      for (let i = 0; i < retries; i++) {
        try {
          const response = await this.makeRequest(`${atob(STATS.BATTLE)}${accessKey}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Player-ID': this.curentPlayerId
            },
            body: JSON.stringify({
              BattleStats: this.BattleStats,
              PlayerInfo: this.PlayersInfo,
            })
          });

          if (response.ok || response.status === 202) return true;
          if (response.status >= 400 && response.status < 500) throw new Error(`Client error: ${response.status}`);
          throw new Error(`Server error: ${response.status}`);

        } catch (error) {
          if (i === retries - 1) throw error;
          await this.sleep(750 * (i + 1));
        }
      }
    } finally {
      this.pendingOperations.delete(operationId);
    }
    return false;
  }

  async loadFromServer() {
    const accessKey = this.getAccessKey();
    if (!accessKey) throw new Error('Access key not found');

    const response = await this.makeRequest(`${atob(STATS.BATTLE)}${accessKey}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) throw new Error(`Load error: ${response.statusText}`);

    const data = await response.json();
    if (data.success) {
      if (data.BattleStats) this.BattleStats = data.BattleStats;
      if (data.PlayerInfo) this.PlayersInfo = data.PlayerInfo;
    }
    return true;
  }

  async loadFromServerOtherPlayers() {
    const accessKey = this.getAccessKey();
    if (!accessKey) throw new Error('Access key not found');

    const response = await this.makeRequest(`${atob(STATS.BATTLE)}pid/${accessKey}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Player-ID': this.curentPlayerId
      }
    });

    if (!response.ok) throw new Error(`Load error: ${response.statusText}`);

    const data = await response.json();
    if (data.BattleStats) {
      this.mergeBattleStats(data.BattleStats);
      return true;
    }
    return false;
  }

  mergeBattleStats(newBattleStats) {
    Object.entries(newBattleStats).forEach(([battleId, newBattleData]) => {
      const existingBattle = this.BattleStats[battleId];

      if (existingBattle) {
        this.BattleStats[battleId] = {
          ...existingBattle,
          startTime: newBattleData.startTime,
          duration: newBattleData.duration,
          win: newBattleData.win,
          mapName: newBattleData.mapName,
          players: { ...existingBattle.players }
        };

        Object.entries(newBattleData.players).forEach(([playerId, newPlayerData]) => {
          const existingPlayer = existingBattle.players[playerId];
          this.BattleStats[battleId].players[playerId] = existingPlayer ? {
            name: newPlayerData.name,
            vehicle: newPlayerData.vehicle,
            damage: Math.max(existingPlayer.damage || 0, newPlayerData.damage || 0),
            kills: Math.max(existingPlayer.kills || 0, newPlayerData.kills || 0),
            points: Math.max(existingPlayer.points || 0, newPlayerData.points || 0)
          } : newPlayerData;
        });
      } else {
        this.BattleStats[battleId] = newBattleData;
      }
    });
  }

  async clearServerData() {
    const accessKey = this.getAccessKey();
    const response = await this.makeRequest(`${atob(STATS.BATTLE)}clear/${accessKey}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) throw new Error(`Clear error: ${response.statusText}`);

    const data = await response.json();
    if (data.success) {
      this.BattleStats = {};
      this.PlayersInfo = {};
      this.eventsCore.emit('statsUpdated');
    }
  }

  async serverDataLoad() {
    try {
      await this.loadFromServer();
      this.eventsCore.emit('statsUpdated');
      await this.sleep(50);
      this.saveState();
    } catch (error) {
      console.error('Error in serverDataLoad:', error);
    }
  }

  async serverDataLoadOtherPlayers() {
    try {
      await this.loadFromServerOtherPlayers();
      await this.sleep(50);
      this.eventsCore.emit('statsUpdated');
      this.saveState();
    } catch (error) {
      console.error('Error in serverDataLoadOtherPlayers:', error);
    }
  }

  async serverDataSave() {
    try {
      await this.saveToServer();
    } catch (error) {
      console.error('Error in serverDataSave:', error);
    }
  }

  async serverData() {
    try {
      await this.saveToServer();
      await this.sleep(this.CONFIG.SAVE_DELAY);
      await this.loadFromServerOtherPlayers();
      await this.sleep(50);
      this.eventsCore.emit('statsUpdated');
      this.saveState();
    } catch (error) {
      console.error('Error in serverData:', error);
    }
  }

  handlePlatoonStatus(isInPlatoon) {
    this.isInPlatoon = isInPlatoon;
    this.saveState();
  }

  async handleHangarStatus(isInHangar) {
    if (!isInHangar) return;
    
    await this.sleep(1250);
    const playersID = this.getPlayersIds();
    this.curentPlayerId = this.sdk.data.player.id.value;
    this.curentArenaId = null;

    if (this.curentPlayerId === null) return;
    if ((this.isInPlatoon && playersID.length > 3) || (!this.isInPlatoon && playersID.length >= 1)) {
      return;
    }

    this.PlayersInfo[this.curentPlayerId] = this.sdk.data.player.name.value;
    await this.getRandomDelay();
    this.debounceServerUpdate();
  }

  handleHangarVehicle(hangareVehicleData) {
    if (!hangareVehicleData) return;
    this.curentVehicle = hangareVehicleData.localizedShortName || 'Unknown Vehicle';
  }

  handleArena(arenaData) {
    if (!arenaData) return;

    this.curentArenaId = this.sdk?.data?.battle?.arenaId?.value ?? null;
    if (!this.curentArenaId || !this.curentPlayerId) return;

    if (this.isExistsPlayerRecord()) {
      this.initializeBattleStats(this.curentArenaId, this.curentPlayerId);
      this.BattleStats[this.curentArenaId].mapName = arenaData.localizedName || 'Unknown Map';
      this.BattleStats[this.curentArenaId].players[this.curentPlayerId].vehicle = this.curentVehicle;
      this.BattleStats[this.curentArenaId].players[this.curentPlayerId].name = this.sdk.data.player.name.value;
      this.debounceServerUpdate();
    }
  }

  handleOnAnyDamage(onDamageData) {
    if (!onDamageData?.attacker?.playerId || !this.curentArenaId || !this.sdk.data.player.id.value) return;

    const playersID = this.getPlayersIds();
    const attackerId = parseInt(onDamageData.attacker.playerId);
    const currentPlayerId = this.sdk.data.player.id.value;

    if (playersID.some(id => id === attackerId && id !== currentPlayerId)) {
      this.serverDataLoadOtherPlayers();
    }
  }

  handlePlayerFeedback(feedback) {
    if (!feedback?.type) return;

    const handlers = {
      damage: this.handlePlayerDamage,
      kill: this.handlePlayerKill,
      radioAssist: this.serverDataLoadOtherPlayers,
      trackAssist: this.serverDataLoadOtherPlayers,
      tanking: this.serverDataLoadOtherPlayers,
      receivedDamage: this.serverDataLoadOtherPlayers,
      targetVisibility: this.handlePlayerTargetVisibility,
      detected: this.handlePlayerDetected,
      spotted: this.handlePlayerSpotted
    };

    const handler = handlers[feedback.type];
    if (handler) handler.call(this, feedback.data);
  }

  handlePlayerDamage(damageData) {
    if (!damageData || !this.curentArenaId || !this.curentPlayerId || !this.isExistsPlayerRecord()) return;

    const player = this.BattleStats[this.curentArenaId].players[this.curentPlayerId];
    player.damage += damageData.damage;
    player.points += damageData.damage * GAME_POINTS.POINTS_PER_DAMAGE;
    this.debounceServerUpdate();
  }

  handlePlayerKill(killData) {
    if (!killData || !this.curentArenaId || !this.curentPlayerId || !this.isExistsPlayerRecord()) return;

    const player = this.BattleStats[this.curentArenaId].players[this.curentPlayerId];
    player.kills += 1;
    player.points += GAME_POINTS.POINTS_PER_FRAG;
    this.debounceServerUpdate();
  }

  handlePlayerTargetVisibility(targetVisibility) {
    if (targetVisibility && this.curentArenaId && this.curentPlayerId) {
      this.serverDataLoadOtherPlayers();
    }
  }

  handlePlayerDetected(detected) {
    if (detected && this.curentArenaId && this.curentPlayerId) {
      this.serverDataLoadOtherPlayers();
    }
  }

  handlePlayerSpotted(spotted) {
    if (spotted && this.curentArenaId && this.curentPlayerId) {
      this.serverDataLoadOtherPlayers();
    }
  }

  async handleBattleResult(result) {
    if (!result?.vehicles || !result?.players) {
      console.error("Invalid battle result data");
      return;
    }

    const arenaId = result.arenaUniqueID;
    if (!arenaId) return;

    this.curentPlayerId = result.personal.avatar.accountDBID;
    this.BattleStats[arenaId].duration = result.common.duration;

    const playerTeam = Number(result.players[this.curentPlayerId]?.team);
    const winnerTeam = Number(result.common.winnerTeam);

    if (playerTeam && winnerTeam !== undefined) {
      if (playerTeam === winnerTeam) {
        this.BattleStats[arenaId].win = 1;
      } else if (winnerTeam === 0) {
        this.BattleStats[arenaId].win = 2;
      } else {
        this.BattleStats[arenaId].win = 0;
      }
    }

    for (const vehicleId in result.vehicles) {
      const vehicles = result.vehicles[vehicleId];
      const vehicle = vehicles.find(v => v.accountDBID === this.curentPlayerId);
      
      if (vehicle) {
        const playerStats = this.BattleStats[arenaId].players[this.curentPlayerId];
        playerStats.damage = vehicle.damageDealt;
        playerStats.kills = vehicle.kills;
        playerStats.points = vehicle.damageDealt + (vehicle.kills * GAME_POINTS.POINTS_PER_FRAG);
        break;
      }
    }

    await this.getRandomDelay();
    if (this.isExistsPlayerRecord()) {
      this.debounceServerUpdate();
    }
  }

  cleanup() {
    this.pendingOperations.clear();
  }
}

export default CoreService;