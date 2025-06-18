class UIService {
  constructor(coreService) {
    this.core = coreService;
    this.CONFIG = {
      MAX_NAME_LENGTH: 16,
      SMALL_FONT_THRESHOLD: 2
    };

    this.core.eventsCore.on('statsUpdated', () => this.updatePlayersUI());
    this.setupEventListeners();
  }

  updatePlayersUI() {
    const container = document.getElementById('player-container');
    if (!container) return;

    const fragment = document.createDocumentFragment();
    const uniquePlayerIds = this.core.getPlayersIds();

    if (uniquePlayerIds.length === 0) {
      this.showEmptyMessage(fragment);
    } else {
      this.renderPlayerRows(fragment, uniquePlayerIds);
    }

    container.innerHTML = '';
    container.appendChild(fragment);
    this.updateTeamStatsUI();
  }

  showEmptyMessage(container) {
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-message';
    emptyMessage.textContent = 'Гравців не знайдено';
    container.appendChild(emptyMessage);
  }

  renderPlayerRows(container, playerIds) {
    const playerRowStyle = playerIds.length > this.CONFIG.SMALL_FONT_THRESHOLD ? 'font-size: 12px;' : '';

    playerIds.forEach(playerId => {
      const playerName = this.core.PlayersInfo[playerId];
      if (playerName) {
        const playerRow = this.createPlayerRow(playerId, playerRowStyle);
        container.appendChild(playerRow);
      }
    });
  }

  createPlayerRow(playerId, style) {
    const playerRow = document.createElement('div');
    playerRow.className = 'player-row';
    if (style) playerRow.style.cssText = style;

    const playerName = this.core.PlayersInfo[playerId];
    const cleanName = this.formatPlayerName(playerName);
    const displayName = this.truncateName(cleanName);

    const { battleDamage, battleKills } = this.getBattleStats(playerId);
    const { playerDamage, playerKills, playerPoints } = this.core.calculatePlayerData(playerId);

    playerRow.innerHTML = `
      <div class="player-name" title="${cleanName}">${displayName}</div>
      <div class="stat-column">
        <div class="damage">+${battleDamage.toLocaleString()}</div>
        <div class="damage-in-battle" style="font-size: 9px; color: #ff6a00;">${playerDamage.toLocaleString()}</div>
      </div>
      <div class="stat-column">
        <div class="frags">+${battleKills}</div>
        <div class="frags-in-battle" style="font-size: 9px; color: #00a8ff;">${playerKills}</div>
      </div>
      <div class="stat-column" style="display:none">
        <div class="points">${playerPoints.toLocaleString()}</div>
      </div>
    `;

    return playerRow;
  }

  getBattleStats(playerId) {
    const arenaId = this.core.curentArenaId;
    const player = this.core.BattleStats[arenaId]?.players?.[playerId];
    
    return {
      battleDamage: player?.damage || 0,
      battleKills: player?.kills || 0
    };
  }

  updateTeamStatsUI() {
    const teamStats = this.core.calculateTeamData();
    const totalBattlePoints = this.core.calculateBattleData();
    const battleStats = this.core.findBestAndWorstBattle();

    this.updateElement('best-battle', battleStats.bestBattle?.points || 0);
    this.updateElement('worst-battle', battleStats.worstBattle?.points || 0);
    this.updateElement('battles-count', `${teamStats.wins}/${teamStats.battles}`);
    this.updateElement('team-now-points', totalBattlePoints.battlePoints);
    this.updateElement('team-points', teamStats.teamPoints);
  }

  updateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = typeof value === 'number' ? value.toLocaleString() : value;
    }
  }

  showSaveNotification() {
    const notification = document.createElement('div');
    Object.assign(notification.style, {
      position: 'fixed', bottom: '20px', right: '20px',
      backgroundColor: 'rgba(46, 204, 113, 0.9)', color: 'white',
      padding: '10px 15px', borderRadius: '4px', fontWeight: '500',
      zIndex: '9999', boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)'
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
      if (isLoading) {
        alert('Оновлення вже виконується, зачекайте будь ласка.');
        return;
      }

      isLoading = true;
      this.setButtonState(refreshBtn, true, 'Оновлення...');

      try {
        await this.core.loadFromServer();
        this.updatePlayersUI();
        this.core.saveState();
      } catch (error) {
        console.error('Помилка при оновленні даних:', error);
        this.showErrorAlert(error);
      } finally {
        isLoading = false;
        this.setButtonState(refreshBtn, false, 'Оновити дані');
      }
    });
  }

  setupRemoveHistoryButton() {
    const restoreBtn = document.getElementById('remove-history-btn');
    if (!restoreBtn) return;

    let isDeleting = false;
  
    restoreBtn.addEventListener('click', async () => {
      if (isDeleting) {
        alert('Процес видалення вже виконується, зачекайте будь ласка.');
        return;
      }

      if (!confirm('Видалити поточну статистику історії боїв?') || 
          !confirm('Ви впевнені? Це незворотна дія!')) {
        return;
      }

      isDeleting = true;
      this.setButtonState(restoreBtn, true, 'Видалення...');

      try {
        try {
          await this.core.loadFromServer();
        } catch (loadError) {
          console.warn('Попередження при завантаженні даних:', loadError);
        }

        await this.core.clearServerData();
        this.core.clearState();
        this.updatePlayersUI();
        alert('Статистику успішно видалено!');
      } catch (error) {
        console.error('Помилка при видаленні статистики:', error);
        this.showErrorAlert(error);
      } finally {
        isDeleting = false;
        this.setButtonState(restoreBtn, false, 'Видалити історію');
      }
    });
  }

  setupViewHistoryButton() {
    const viewHistoryBtn = document.getElementById('view-history-btn');
    if (viewHistoryBtn) {
      const accessKey = this.core.getAccessKey();
      viewHistoryBtn.addEventListener('click', () => {
        window.open('./battle-history/?' + accessKey, '_blank');
      });
    }
  }

  setButtonState(button, disabled, text) {
    button.disabled = disabled;
    button.textContent = text;
  }

  showErrorAlert(error) {
    const errorMessages = {
      'Empty history': 'Історія боїв порожня.',
      'Network error': 'Помилка з`єднання з сервером. Перевірте підключення до інтернету.',
      'Permission denied': 'Немає прав для видалення даних.'
    };

    const message = errorMessages[error.message] || `Помилка: ${error.message}`;
    alert(message);
  }

  formatPlayerName(name) {
    return name ? String(name).replace(/\s*\[.*?\]/, '') : 'Невідомий гравець';
  }

  truncateName(name) {
    if (!name) return 'Невідомий';
    return name.length > this.CONFIG.MAX_NAME_LENGTH ? 
           name.substring(0, this.CONFIG.MAX_NAME_LENGTH) + '...' : name;
  }
}

export default UIService;