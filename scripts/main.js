import CoreService from './coreService.js';
import UIService from './uiService.js';
import { STATS } from '../battle-history/scripts/constants.js';

export default class SquadWidget {
  constructor() {
    // Додаємо невелику затримку, щоб переконатися, що DOM готовий
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  async init() {
    console.log('SquadWidget initializing...');
    try {
      const hasAccess = await this.checkAccessKey();
      console.log('Access check result:', hasAccess);
      
      if (!hasAccess) {
        console.log('No access - showing access denied');
        this.showAccessDenied();
        return;
      }
      
      console.log('Access granted - initializing services');
      this.initializeServices();
    } catch (error) {
      console.error('Error in init:', error);
      this.showAccessDenied();
    }
  }

  initializeServices() {
    try {
      this.coreService = new CoreService();
      this.uiService = new UIService(this.coreService);
      this.initialize();
    } catch (error) {
      console.error('Error initializing services:', error);
      this.showAccessDenied();
    }
  }

  initialize() {
    try {
      this.coreService.loadFromServer()
        .then(() => {
          this.uiService.updatePlayersUI();
        })
        .catch(error => {
          console.error('Error loading data:', error);
          this.uiService.updatePlayersUI();
        });
    } catch (error) {
      console.error('Error in initialize:', error);
    }
  }

  async checkAccessKey() {
    try {
      console.log('Checking access key...');
      localStorage.removeItem('accessKey');
      const urlParams = window.location.search.substring(1);
      console.log('URL params:', urlParams);
      
      if (!urlParams) {
        console.log('No URL params found');
        return false;
      }
  
      const apiUrl = `${atob(STATS.BATTLE)}${urlParams}`;
      console.log('Making request to:', apiUrl);
  
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
  
      console.log('Response status:', response.status);
  
      if (response.status === 401) {
        console.log('Unauthorized access');
        return false;
      }
  
      if (!response.ok) {
        console.log('Response not ok:', response.status);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const data = await response.json();
      console.log('Response data:', data);
  
      if (data.success) {
        localStorage.setItem('accessKey', urlParams);
        console.log('Access key saved');
        return true;
      }
      
      console.log('Data success is false');
      return false;
  
    } catch (error) {
      console.error('Error in checkAccessKey:', error);
      if (!(error instanceof Response) || error.status !== 401) {
        console.error('Detailed error:', error);
      }
      return false;
    }
  }

  showAccessDenied() {
    console.log('Showing access denied screen');
    try {
      // Очікуємо, поки DOM буде готовий
      const showDenied = () => {
        console.log('Creating access denied UI');
        
        // Очищаємо весь контент сторінки
        document.body.innerHTML = '';
        
        const container = document.createElement('div');
        container.id = 'access-denied-container';
        container.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          background-color: rgba(0, 0, 0, 0.8);
          z-index: 99999;
          font-family: Arial, sans-serif;
        `;

        const message = document.createElement('div');
        message.style.cssText = `
          text-align: center;
          padding: 3em;
          border-radius: 1em;
          background-color: rgba(20, 20, 20, 0.95);
          color: #ffffff;
          border: 2px solid #ff4444;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
          max-width: 400px;
        `;

        message.innerHTML = `
          <h2 style="color: #ff4444; margin-bottom: 1em; font-size: 1.5em;">Доступ заборонено</h2>
          <p style="margin-bottom: 1em; font-size: 1.1em;">Невірний ключ доступу</p>
          <p style="font-size: 0.9em; color: #cccccc;">Перевірте правильність посилання</p>
        `;

        container.appendChild(message);
        document.body.appendChild(container);
        
        console.log('Access denied UI created');
      };

      if (document.body) {
        showDenied();
      } else {
        // Якщо body ще не готовий, чекаємо
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', showDenied);
        } else {
          // Якщо readyState не loading, але body немає, чекаємо трохи
          setTimeout(showDenied, 100);
        }
      }
    } catch (error) {
      console.error('Error in showAccessDenied:', error);
      alert('Доступ заборонено. Невірний ключ доступу.');
    }
  }
}

console.log('Creating SquadWidget instance...');
new SquadWidget();