const amqp = require('amqplib');
const { EventEmitter } = require('events');
const { isEmpty } = require('lodash');

const conn = Symbol('connection');
const channels = Symbol('channels');

class RabbitMQClient extends EventEmitter {
  constructor(options = {}) {
    super();

    if (isEmpty(options)) {
      throw new Error('Empty options');
    }

    this[conn] = {
      options: options.connection,
      status: 0,
      conn: null,
      reconnectInterval: null,
      isNeedReconnect: !!options.isNeedReconnect,
    };

    this[channels] = {};
  }

  get connection() {
    return this[conn].connection;
  }

  get channels() {
    return this[channels];
  }

  async openConnection() {
    try {
      if ([1, 2].includes(this[conn].status)) {
        return this[conn];
      }

      this[conn].status = 1;
      this[conn].connection = await amqp.connect(this[conn].options);
      this[conn].status = 2;

      this[conn].connection.on('close', err => {
        this[conn].status = 3;

        if (this[conn].isNeedReconnect) {
          this[conn].reconnectInterval = setInterval(() => {
            this.openConnection().then(({ status }) => {
              if (status === 2) {
                clearInterval(this[conn].reconnectInterval);
                this[conn].reconnectInterval = null;
              }
            });
          }, 10 * 1000);
        }

        super.emit('connection:closed', { err });
      });

      return this[conn];
    } catch (err) {
      this[conn].status = 3;
      throw err;
    }
  }

  async createChannel(name, options = {}) {
    try {
      const isExistChannel =
        this[channels][name] && [1, 2].includes(this[channels][name].status);

      if (isExistChannel) {
        return this[channels][name];
      }

      if (this[conn].status !== 2) {
        throw new Error('Not found connection');
      }

      if (!this[channels][name]) {
        this[channels][name] = {
          channel: null,
          status: 0,
          isNeedRecreate: !!options.isNeedRecreate,
          reconnectInterval: null,
          isConfirmChannel: !!options.isConfirmChannel,
        };
      }

      this[channels][name].status = 1;

      if (this[channels][name].isConfirmChannel) {
        this[channels][name].channel = await this[
          conn
        ].connection.createConfirmChannel();
      } else {
        this[channels][name].channel = await this[
          conn
        ].connection.createChannel();
      }

      this[channels][name].status = 2;

      this[channels][name].channel.on('close', err => {
        this.channels[name].status = 3;

        if (this[channels][name].isNeedRecreate) {
          this[channels][name].reconnectInterval = setInterval(() => {
            this.createChannel(name, options).then(() => {
              super.emit('channel:recreated', { channel: name });
            });
          }, 10 * 1000);
        }
        super.emit('channel:closed', { channel: name, err });
      });

      this[channels][name].channel.on('error', err => {
        super.emit('channel:error', { channel: name, err });
      });

      return this[channels][name];
    } catch (err) {
      this[channels][name].status = 3;
      throw err;
    }
  }

  getChannelByName(name) {
    if (!name) {
      throw new Error('Name is required');
    }

    if (!this[channels][name]) {
      throw new Error('Channel not found');
    }

    return this[channels][name].channel;
  }

  isReadyConnection() {
    return this[conn].status === 2;
  }

  isReadyChannel(name) {
    if (!name) {
      throw new Error('Name is required');
    }

    if (!this[channels][name]) {
      throw new Error('Channel not found');
    }

    return this[channels][name].status === 2;
  }
}

module.exports = RabbitMQClient;
