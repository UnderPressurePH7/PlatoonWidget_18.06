import { Utils } from '../battle-history/scripts/utils.js';
import { CONFIG } from '../battle-history/scripts/constants.js';

class UIService {
  constructor(coreService) {
    this.core = coreService;
    this.updateThrottle = Utils.throttle(this.updatePlayersUI.bind(this), CONFIG.THROTTLE_DELAY);
    
    this.core.eventsCore.on('statsUpdated', this.updateThrottle);
    this.setupEventListeners();
  }

  updatePlayersUI() {
    const container = document.getElementById('player-container');
    if (!container) return;
    
    container.innerHTML = '';

    const uniquePlayerIds = this.core.getPlayersIds();

    if (uniquePlayerIds.length === 0) {
      this.showEmptyMessage(container);
      return;
    }

    this.renderPlayerRows(container, uniquePlayerIds);
    this.updateTeamStatsUI();
  }

  showEmptyMessage(container) {
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-message';
    emptyMessage.textContent = 'Гравців не знайдено';
    container.appendChild(emptyMessage);
  }

  renderPlayerRows(container, playerIds) {
    const playerRowStyle = playerIds.length > 2 ? 'font-size: 12px;' : '';

    playerIds.forEach(playerId => {
      const playerName = this.core.PlayersInfo[playerId];
      if (!playerName) return;

      const playerRow = this.createPlayerRow(playerId, playerRowStyle);
      container.appendChild(playerRow);
    });
  }

  createPlayerRow(playerId, style) {
    const playerRow = document.createElement('div');
    playerRow.className = 'player-row';
    if (style) playerRow.style = style;

    const playerName = this.core.PlayersInfo[playerId];
    const arenaId = this.core.curentArenaId;
    const cleanName = Utils.formatPlayerName(playerName);
    const displayName = Utils.truncateName(cleanName);

    let battleDamage = 0;
    let battleKills = 0;

    if (arenaId && this.core.BattleStats[arenaId] &&
      this.core.BattleStats[arenaId].players &&
      this.core.BattleStats[arenaId].players[playerId]) {
      battleDamage = this.core.BattleStats[arenaId].players[playerId].damage || 0;
      battleKills = this.core.BattleStats[arenaId].players[playerId].kills || 0;
    }

    const totalPlayerData = this.core.calculatePlayerData(playerId);
    const displayDamage = totalPlayerData.playerDamage;
    const displayKills = totalPlayerData.playerKills;
    const playerPoints = totalPlayerData.playerPoints;

    playerRow.innerHTML = `
      <div class="player-name" title="${cleanName}">${displayName}</div>
      <div class="stat-column">
        <div class="damage">+${battleDamage.toLocaleString()}</div>
        <div class="damage-in-battle" style="font-size: 9px; color: #ff6a00;">${displayDamage.toLocaleString()}</div>
      </div>
      <div class="stat-column">
        <div class="frags">+${battleKills}</div>
        <div class="frags-in-battle" style="font-size: 9px; color: #00a8ff;">${displayKills}</div>
      </div>
      <div class="stat-column" style="display:none">
        <div class="points">${playerPoints.toLocaleString()}</div>
      </div>
    `;

    return playerRow;
  }

  updateTeamStatsUI() {
    const teamStats = this.core.calculateTeamData();
    const totalBattlePoints = this.core.calculateBattleData();
    
    const battleStats = this.core.findBestAndWorstBattle();
    
    this.updateElement('best-battle', battleStats.bestBattle?.points?.toLocaleString() || '0');
    this.updateElement('worst-battle', battleStats.worstBattle?.points?.toLocaleString() || '0');
    this.updateElement('battles-count', `${teamStats.wins}/${teamStats.battles}`);
    this.updateElement('team-now-points', totalBattlePoints.battlePoints.toLocaleString());
    this.updateElement('team-points', teamStats.teamPoints.toLocaleString());
  }

  resetTeamStatsUI() {
    this.updateElement('best-battle', '0');
    this.updateElement('worst-battle', '0');
    this.updateElement('battles-count', '0/0');
    this.updateElement('team-now-points', '0');
    this.updateElement('team-points', '0');
  }

  updateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  showSaveNotification() {
    const notification = document.createElement('div');
    Object.assign(notification.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      backgroundColor: 'rgba(46, 204, 113, 0.9)',
      color: 'white',
      padding: '10px 15px',
      borderRadius: '4px',
      fontWeight: '500',
      zIndex: '9999',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)'
    });

    notification.textContent = 'Бій збережено в історію';
    document.body.appendChild(notification);

    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 3000);
  }

  setupEventListeners() {
    this.setupRefreshButton();
    this.setupRemoveHistoryButton();
    this.setupViewHistoryButton();
  }

  setupRefreshButton() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (!refreshBtn) return;

    let isLoading = false;
    
    refreshBtn.addEventListener('click', async () => {
      // if (isLoading) {
      //   alert('Оновлення вже виконується, зачекайте будь ласка.');
      //   return;
      // }

      try {
        isLoading = true;
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Оновлення...';

        await this.core.loadFromServer();
        this.updatePlayersUI();
        this.core.saveState();

      } catch (error) {
        console.error('Помилка при оновленні даних:', error);
        this.handleError(error);
      } finally {
        isLoading = false;
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Оновити дані';
      }
    });
  }

  setupRemoveHistoryButton() {
    const restoreBtn = document.getElementById('remove-history-btn');
    if (!restoreBtn) return;

    let isDeleting = false;
  
    restoreBtn.addEventListener('click', async () => {
      // if (isDeleting) {
      //   alert('Процес видалення вже виконується, зачекайте будь ласка.');
      //   return;
      // }

      if (!confirm('Видалити поточну статистику історії боїв?')) {
        return;
      }

      try {
        isDeleting = true;
        restoreBtn.disabled = true;
        restoreBtn.textContent = 'Видалення...';

        try {
          await this.core.loadFromServer();
        } catch (loadError) {
          console.warn('Попередження при завантаженні даних:', loadError);
        }

        await this.core.clearServerData();
        this.core.clearState();
        this.updatePlayersUI();
        
        localStorage.clear();
        this.resetTeamStatsUI();

      } catch (error) {
        console.error('Помилка при видаленні статистики:', error);
        this.handleError(error);
      } finally {
        isDeleting = false;
        restoreBtn.disabled = false;
        restoreBtn.textContent = 'Видалити історію';
      }
    });
  }

  setupViewHistoryButton() {
    const viewHistoryBtn = document.getElementById('view-history-btn');
    if (!viewHistoryBtn) return;

    const accessKey = this.core.getAccessKey();
    viewHistoryBtn.addEventListener('click', () => {
      window.open('./battle-history/?' + accessKey, '_blank');
    });
  }

  handleError(error) {
    const errorMessages = {
      'Empty history': 'Історія боїв порожня.',
      'Network error': 'Помилка з`єднання з сервером. Перевірте підключення до інтернету.',
      'Permission denied': 'Немає прав для виконання операції.',
      'Access key not found': 'Ключ доступу не знайдено.'
    };

    const message = errorMessages[error.message] || `Помилка: ${error.message}`;
    // alert(message);
  }
}

export default UIService;