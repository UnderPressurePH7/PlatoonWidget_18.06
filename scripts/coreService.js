import EventEmitter from '../battle-history/utils/eventEmitter.js';
import { GAME_POINTS, STATS, CONFIG} from '../battle-history/utils/constants.js';
import { StateManager } from '../battle-history/utils/stateManager.js';
import { Utils } from '../battle-history/utils/utils.js';

class CoreService {
  constructor() {
    this.initializeSDK();
    this.initializeState();
    this.initializeCache();
    this.setupSDKListeners();
    this.eventsCore = new EventEmitter();
    this.setupDebouncedMethods();
    this.loadFromServer();
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
    const savedState = StateManager.loadState();
    if (savedState) {
      this.BattleStats = savedState.BattleStats || {};
      this.PlayersInfo = savedState.PlayersInfo || {};
      this.curentPlayerId = savedState.curentPlayerId || null;
      this.curentArenaId = savedState.curentArenaId || null;
      this.curentVehicle = savedState.curentVehicle || null;
      this.isInPlatoon = savedState.isInPlatoon || false;
    } else {
      this.resetState();
    }
  }

  initializeCache() {
    this.calculationCache = new Map();
  }

  resetState() {
    this.BattleStats = {};
    this.PlayersInfo = {};
    this.curentPlayerId = this.sdk.data.player.id.value;
    this.curentArenaId = null;
    this.curentVehicle = null;
    this.isInPlatoon = false;
  }

  setupDebouncedMethods() {
    this.serverDataDebounced = Utils.debounce(this.serverData.bind(this), CONFIG.DEBOUNCE_DELAY);
    this.serverDataLoadOtherPlayersDebounced = Utils.debounce(this.serverDataLoadOtherPlayers.bind(this), CONFIG.DEBOUNCE_DELAY);
  }

  setupSDKListeners() {
    this.sdk.data.hangar.isInHangar.watch(this.handleHangarStatus.bind(this));
    this.sdk.data.hangar.vehicle.info.watch(this.handleHangarVehicle.bind(this));
    this.sdk.data.platoon.isInPlatoon.watch(this.handlePlatoonStatus.bind(this));
    this.sdk.data.battle.arena.watch(this.handleArena.bind(this));
    this.sdk.data.battle.onDamage.watch(this.handleOnAnyDamage.bind(this));
    this.sdk.data.battle.onPlayerFeedback.watch(this.handlePlayerFeedback.bind(this));
    this.sdk.data.battle.onBattleResult.watch(this.handleBattleResult.bind(this));
  }

  // Utility methods
  isValidBattleState() {
    return this.curentArenaId && this.curentPlayerId;
  }

  clearCalculationCache() {
    this.calculationCache.clear();
  }

  saveState() {
    const state = {
      BattleStats: this.BattleStats,
      PlayersInfo: this.PlayersInfo,
      curentPlayerId: this.curentPlayerId,
      curentArenaId: this.curentArenaId,
      curentVehicle: this.curentVehicle,
      isInPlatoon: this.isInPlatoon
    };
    StateManager.saveState(state);
  }

  clearState() {
    StateManager.clearState();
    this.resetState();
    this.clearCalculationCache();
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
    const playersIds = this.getPlayersIds();
    return playersIds.includes(this.curentPlayerId);
  }

  findBestAndWorstBattle() {
    const allBattles = Object.entries(this.BattleStats).map(([arenaId, battle]) => ({
      id: arenaId,
      ...battle
    }));

    if (!allBattles || allBattles.length === 0) {
      return { bestBattle: null, worstBattle: null };
    }

    const completedBattles = allBattles.filter(battle => battle.win !== -1);

    if (completedBattles.length === 0) {
      return { bestBattle: null, worstBattle: null };
    }

    try {
      let worstBattle = completedBattles[0];
      let bestBattle = completedBattles[0];
      let worstBattlePoints = this.calculateBattlePoints(worstBattle);
      let bestBattlePoints = worstBattlePoints;

      completedBattles.forEach(battle => {
        try {
          const battlePoints = this.calculateBattlePoints(battle);

          if (battlePoints < worstBattlePoints) {
            worstBattle = battle;
            worstBattlePoints = battlePoints;
          }

          if (battlePoints > bestBattlePoints) {
            bestBattle = battle;
            bestBattlePoints = battlePoints;
          }
        } catch (error) {
          console.error('Помилка при обчисленні даних бою:', error, battle);
        }
      });

      return {
        bestBattle: { battle: bestBattle, points: bestBattlePoints },
        worstBattle: { battle: worstBattle, points: worstBattlePoints }
      };
    } catch (error) {
      console.error('Помилка при пошуку найгіршого/найкращого бою:', error);
      return { bestBattle: null, worstBattle: null };
    }
  }

  calculateBattlePoints(battle) {
    let battlePoints = 0;

    if (battle.win === 1) {
      battlePoints += GAME_POINTS.POINTS_PER_TEAM_WIN;
    }

    if (battle && battle.players) {
      Object.values(battle.players).forEach(player => {
        battlePoints += player.points || 0;
      });
    }

    return battlePoints;
  }

  calculateBattleData(arenaId = this.curentArenaId) {
    const cacheKey = `battle_${arenaId}`;
    
    if (this.calculationCache.has(cacheKey)) {
      return this.calculationCache.get(cacheKey);
    }

    let battlePoints = 0;
    let battleDamage = 0;
    let battleKills = 0;

    try {
      if (this.BattleStats[arenaId] && this.BattleStats[arenaId].players) {
        for (const playerId in this.BattleStats[arenaId].players) {
          const player = this.BattleStats[arenaId].players[playerId];
          battlePoints += player.points || 0;
          battleDamage += player.damage || 0;
          battleKills += player.kills || 0;
        }
      }
    } catch (error) {
      console.error('Помилка при розрахунку бойових даних:', error);
    }

    const result = { battlePoints, battleDamage, battleKills };
    this.calculationCache.set(cacheKey, result);
    return result;
  }

  calculatePlayerData(playerId) {
    const cacheKey = `player_${playerId}_${Object.keys(this.BattleStats).length}`;
    
    if (this.calculationCache.has(cacheKey)) {
      return this.calculationCache.get(cacheKey);
    }

    let playerPoints = 0;
    let playerDamage = 0;
    let playerKills = 0;

    try {
      for (const arenaId in this.BattleStats) {
        const player = this.BattleStats[arenaId].players[playerId];
        if (player) {
          playerPoints += player.points || 0;
          playerDamage += player.damage || 0;
          playerKills += player.kills || 0;
        }
      }
    } catch (error) {
      console.error('Помилка при розрахунку даних гравця:', error);
    }

    const result = { playerPoints, playerDamage, playerKills };
    this.calculationCache.set(cacheKey, result);
    return result;
  }

  calculateTeamData() {
    const cacheKey = `team_${Object.keys(this.BattleStats).length}`;
    
    if (this.calculationCache.has(cacheKey)) {
      return this.calculationCache.get(cacheKey);
    }

    let teamPoints = 0;
    let teamDamage = 0;
    let teamKills = 0;
    let wins = 0;
    let battles = 0;

    try {
      for (const arenaId in this.BattleStats) {
        battles++;
        if (this.BattleStats[arenaId].win === 1) {
          teamPoints += GAME_POINTS.POINTS_PER_TEAM_WIN;
          wins++;
        }

        for (const playerId in this.BattleStats[arenaId].players) {
          const player = this.BattleStats[arenaId].players[playerId];
          teamPoints += player.points || 0;
          teamDamage += player.damage || 0;
          teamKills += player.kills || 0;
        }
      }
    } catch (error) {
      console.error('Помилка при розрахунку даних команди:', error);
    }

    const result = { teamPoints, teamDamage, teamKills, wins, battles };
    this.calculationCache.set(cacheKey, result);
    return result;
  }

  getAccessKey() {
    return StateManager.getAccessKey();
  }

  async saveToServer(retries = CONFIG.RETRY_ATTEMPTS) {
    const accessKey = this.getAccessKey();
    if (!accessKey) {
      throw new Error('Access key not found');
    }

    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.SERVER_TIMEOUT);

        const response = await fetch(`${atob(STATS.BATTLE)}${accessKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Player-ID': this.curentPlayerId
          },
          body: JSON.stringify({
            BattleStats: this.BattleStats,
            PlayerInfo: this.PlayersInfo,
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok && response.status !== 202) {
          throw new Error(`Server error: ${response.status}`);
        }

        return true;

      } catch (error) {
        console.error(`Attempt ${i + 1} failed:`, error);
        if (i === retries - 1) throw error;
        await Utils.sleep(CONFIG.RETRY_DELAY * (i + 1));
      }
    }
    return false;
  }

  async loadFromServer() {
    try {
      const accessKey = this.getAccessKey();
      if (!accessKey) {
        throw new Error('Access key not found');
      }

      const response = await fetch(`${atob(STATS.BATTLE)}${accessKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Помилка при завантаженні даних: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        if (data.BattleStats) {
          this.BattleStats = data.BattleStats;
        }
        if (data.PlayerInfo) {
          this.PlayersInfo = data.PlayerInfo;
        }
        this.clearCalculationCache();
      }
      return true;
    } catch (error) {
      console.error('Помилка при завантаженні даних із сервера:', error);
      throw error;
    }
  }

  async loadFromServerOtherPlayers() {
    try {
      const accessKey = this.getAccessKey();
      if (!accessKey) {
        throw new Error('Access key not found');
      }

      const response = await fetch(`${atob(STATS.BATTLE)}pid/${accessKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Player-ID': this.curentPlayerId
        },
      });

      if (!response.ok) {
        throw new Error(`Помилка при завантаженні даних: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.BattleStats) {
        Object.entries(data.BattleStats).forEach(([battleId, newBattleData]) => {
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

              if (existingPlayer) {
                this.BattleStats[battleId].players[playerId] = {
                  name: newPlayerData.name,
                  vehicle: newPlayerData.vehicle,
                  damage: Math.max(existingPlayer.damage || 0, newPlayerData.damage || 0),
                  kills: Math.max(existingPlayer.kills || 0, newPlayerData.kills || 0),
                  points: Math.max(existingPlayer.points || 0, newPlayerData.points || 0)
                };
              } else {
                this.BattleStats[battleId].players[playerId] = newPlayerData;
              }
            });
          } else {
            this.BattleStats[battleId] = newBattleData;
          }
        });

        this.clearCalculationCache();
        return true;
      }

      return false;
    } catch (error) {
      console.error('Помилка при завантаженні даних із сервера:', error);
      throw error;
    }
  }

  async clearServerData() {
    try {
      const accessKey = this.getAccessKey();
      const response = await fetch(`${atob(STATS.BATTLE)}clear/${accessKey}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
      });

      if (!response.ok) {
        throw new Error(`Помилка при очищенні даних: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        this.BattleStats = {};
        this.PlayersInfo = {};
        this.clearCalculationCache();
        this.eventsCore.emit('statsUpdated');
      }

    } catch (error) {
      console.error('Помилка при очищенні даних на сервері:', error);
      throw error;
    }
  }

  async warmupServer() {
    try {
      const response = await fetch(`${atob(STATS.STATUS)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Помилка при завантаженні даних: ${response.statusText}`);
      }

      return true;
    } catch (error) {
      console.error('Помилка при завантаженні даних із сервера:', error);
      throw error;
    }
  }

  async serverDataLoad() {
    try {
      await this.loadFromServer();
      this.eventsCore.emit('statsUpdated');
      await Utils.sleep(CONFIG.UI_UPDATE_DELAY);
      this.saveState();
    } catch (error) {
      console.error('Error in serverDataLoad:', error);
    }
  }

  async serverDataLoadOtherPlayers() {
    try {
      await this.loadFromServerOtherPlayers();
      await Utils.sleep(CONFIG.UI_UPDATE_DELAY);
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
      await Utils.sleep(250);
      await this.loadFromServerOtherPlayers();
      await Utils.sleep(CONFIG.UI_UPDATE_DELAY);
      this.eventsCore.emit('statsUpdated');
      this.saveState();
    } catch (error) {
      console.error('Error in serverData:', error);
    }
  }

  // Event handlers
  handlePlatoonStatus(isInPlatoon) {
    this.isInPlatoon = isInPlatoon;
    this.saveState();
  }

  async handleHangarStatus(isInHangar) {
    if (!isInHangar) return;
    
    await Utils.sleep(CONFIG.HANGAR_DELAY);
    const playersID = this.getPlayersIds();
    this.curentPlayerId = this.sdk.data.player.id.value;
    this.curentArenaId = null;

    if (this.curentPlayerId === null) return;
    if ((this.isInPlatoon && playersID.length > 3) || (!this.isInPlatoon && playersID.length >= 1)) {
      return;
    }

    this.PlayersInfo[this.curentPlayerId] = this.sdk.data.player.name.value;

    await Utils.getRandomDelay();
    this.serverDataDebounced();
  }

  handleHangarVehicle(hangareVehicleData) {
    if (!hangareVehicleData) return;
    this.curentVehicle = hangareVehicleData.localizedShortName || 'Unknown Vehicle';
  }

  handleArena(arenaData) {
    if (!arenaData) return;

    this.curentArenaId = this.sdk?.data?.battle?.arenaId?.value ?? null;

    if (this.curentArenaId == null) return;
    if (this.curentPlayerId == null) return;

    if (this.isExistsPlayerRecord()) {
      this.serverDataLoadOtherPlayersDebounced();
      
      this.initializeBattleStats(this.curentArenaId, this.curentPlayerId);

      this.BattleStats[this.curentArenaId].mapName = arenaData.localizedName || 'Unknown Map';
      this.BattleStats[this.curentArenaId].players[this.curentPlayerId].vehicle = this.curentVehicle;
      this.BattleStats[this.curentArenaId].players[this.curentPlayerId].name = this.sdk.data.player.name.value;

      this.serverDataDebounced();
    }
  }

  handleOnAnyDamage(onDamageData) {
    if (!onDamageData || !onDamageData.attacker.playerId || !this.curentArenaId || !this.sdk.data.player.id.value) return;

    const playersID = this.getPlayersIds();

    for (const playerId of playersID) {
      if (onDamageData.attacker.playerId === parseInt(playerId) && parseInt(playerId) !== this.sdk.data.player.id.value) {
        this.serverDataLoadOtherPlayersDebounced();
        break;
      }
    }
  }

  handlePlayerFeedback(feedback) {
    if (!feedback || !feedback.type) return;

    const handlers = {
      'damage': this.handlePlayerDamage.bind(this),
      'kill': this.handlePlayerKill.bind(this),
      'radioAssist': this.handleGenericPlayerEvent.bind(this),
      'trackAssist': this.handleGenericPlayerEvent.bind(this),
      'tanking': this.handleGenericPlayerEvent.bind(this),
      'receivedDamage': this.handleGenericPlayerEvent.bind(this),
      'targetVisibility': this.handleGenericPlayerEvent.bind(this),
      'detected': this.handleGenericPlayerEvent.bind(this),
      'spotted': this.handleGenericPlayerEvent.bind(this)
    };

    const handler = handlers[feedback.type];
    if (handler) {
      handler(feedback.data);
    }
  }

  handleGenericPlayerEvent(eventData) {
    if (!eventData || !this.isValidBattleState()) return;
    this.serverDataLoadOtherPlayersDebounced();
  }

  handlePlayerDamage(damageData) {
    if (!damageData || !this.isValidBattleState()) return;

    const arenaId = this.curentArenaId;
    const playerId = this.curentPlayerId;
    
    if (this.isExistsPlayerRecord()) {
      this.BattleStats[arenaId].players[playerId].damage += damageData.damage;
      this.BattleStats[arenaId].players[playerId].points += damageData.damage * GAME_POINTS.POINTS_PER_DAMAGE;
      this.clearCalculationCache();
      this.serverDataDebounced();
    }
  }

  handlePlayerKill(killData) {
    if (!killData || !this.isValidBattleState()) return;

    const arenaId = this.curentArenaId;
    const playerId = this.curentPlayerId;
    
    if (this.isExistsPlayerRecord()) {
      this.BattleStats[arenaId].players[playerId].kills += 1;
      this.BattleStats[arenaId].players[playerId].points += GAME_POINTS.POINTS_PER_FRAG;
      this.clearCalculationCache();
      this.serverDataDebounced();
    }
  }

  async handleBattleResult(result) {
    if (!result || !result.vehicles || !result.players) {
      console.error("Invalid battle result data");
      return;
    }

    const arenaId = result.arenaUniqueID;
    if (!arenaId) return;

    this.curentPlayerId = result.personal.avatar.accountDBID;
    this.BattleStats[arenaId].duration = result.common.duration;

    const playerTeam = Number(result.players[this.curentPlayerId].team);
    const winnerTeam = Number(result.common.winnerTeam);

    if (playerTeam !== undefined && playerTeam !== 0 && winnerTeam !== undefined) {
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
      for (const vehicle of vehicles) {
        if (vehicle.accountDBID === this.curentPlayerId) {
          const playerStats = this.BattleStats[arenaId].players[this.curentPlayerId];
          playerStats.damage = vehicle.damageDealt;
          playerStats.kills = vehicle.kills;
          playerStats.points = vehicle.damageDealt + (vehicle.kills * GAME_POINTS.POINTS_PER_FRAG);
          break;
        }
      }
    }

    this.clearCalculationCache();
    await Utils.getRandomDelay();
    
    if (this.isExistsPlayerRecord()) {
      this.serverDataDebounced();
    }
  }
}

export default CoreService;