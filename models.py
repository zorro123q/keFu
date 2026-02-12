"""Database models for the marketing platform.

These SQLAlchemy models define the core entities used by the
application.  They map closely to the data requirements outlined in
the specification document, though some fields have been simplified
for a minimal viable product.  Additional columns and tables can
easily be added as the platform evolves.
"""

from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import Column, DateTime, Enum, Integer, String, Text, ForeignKey
from sqlalchemy.orm import declarative_base, relationship


Base = declarative_base()


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=True)
    phone = Column(String(20), nullable=True, unique=False)
    wechat = Column(String(50), nullable=True, unique=False)
    qq = Column(String(50), nullable=True, unique=False)
    company = Column(String(100), nullable=True)
    position = Column(String(100), nullable=True)
    industry = Column(String(50), nullable=True)
    region = Column(String(50), nullable=True)
    channel = Column(String(50), nullable=True)
    collected_time = Column(DateTime, nullable=True)
    add_status = Column(String(20), nullable=True, default="未添加")
    group = Column(String(50), nullable=True)
    intention = Column(String(10), nullable=True, default="无")
    remarks = Column(Text, nullable=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

    messages = relationship("MessageLog", back_populates="customer")

    def __repr__(self) -> str:
        return f"<Customer id={self.id} name={self.name}>"


class Template(Base):
    __tablename__ = "templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    content = Column(Text, nullable=False)
    type = Column(String(50), nullable=True)  # welcome, product_intro, follow_up, etc.
    scene = Column(String(100), nullable=True)
    is_active = Column(Integer, default=1)  # 1 active, 0 inactive
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

    def __repr__(self) -> str:
        return f"<Template id={self.id} name={self.name}>"


class MessageLog(Base):
    __tablename__ = "message_logs"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    send_time = Column(DateTime, default=dt.datetime.utcnow)
    send_type = Column(String(20), nullable=False)  # group or single
    message_content = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="发送成功")
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow)

    customer = relationship("Customer", back_populates="messages")

    def __repr__(self) -> str:
        return f"<MessageLog id={self.id} customer_id={self.customer_id}>"


class CommandLog(Base):
    __tablename__ = "command_logs"

    id = Column(Integer, primary_key=True, index=True)
    command_content = Column(Text, nullable=False)
    standardized_command = Column(Text, nullable=True)
    account = Column(String(50), nullable=True)
    time = Column(DateTime, default=dt.datetime.utcnow)
    status = Column(String(20), nullable=False, default="待执行")  # pending, running, success, failure
    result = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    duration = Column(Integer, nullable=True)  # seconds
    created_at = Column(DateTime, default=dt.datetime.utcnow)

    def __repr__(self) -> str:
        return f"<CommandLog id={self.id} command='{self.command_content[:20]}...'>"
