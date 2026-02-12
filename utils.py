"""Utility functions used by the marketing platform.

This module contains helper functions for command parsing, fake
customer generation and message composition.  These abstractions
encapsulate logic that may later be replaced with large‑model calls
or more sophisticated NLP pipelines.  For now they provide a
deterministic and local implementation suitable for the MVP.
"""

from __future__ import annotations

import re
import random
import datetime as dt
from typing import Any, Dict, List, Optional

from faker import Faker

fake = Faker("zh_CN")


def parse_command(text: str) -> Dict[str, Any]:
    """Parse a natural language command into a structured dict.

    The parser implements a small set of heuristics to detect core
    actions described in the requirements document.  It recognises
    commands for gathering customer information, adding friends,
    sending messages and generating reports.  If no known pattern is
    matched the command is returned with an "unknown" action.

    Parameters
    ----------
    text: str
        The raw command string from the user.

    Returns
    -------
    Dict[str, Any]
        A dictionary with at minimum an ``action`` key.  Additional
        keys depend on the recognised action.
    """
    command = text.strip()
    result: Dict[str, Any] = {"action": "unknown", "raw": command}

    # Match gather command: 搜集XX行业客户信息30条 or 搜集餐饮行业客户信息50条
    m = re.search(r"搜集(?P<industry>[\u4e00-\u9fa5\w]+)行业?客户信息(?P<number>\d+)条", command)
    if m:
        result.update(
            {
                "action": "gather",
                "industry": m.group("industry"),
                "number": int(m.group("number")),
            }
        )
        return result

    # Match add friends: 添加XX行业客户微信 or 添加今日新增客户
    m = re.search(r"添加(?P<target>[\u4e00-\u9fa5\w]+)客户", command)
    if m:
        result.update(
            {
                "action": "add_friends",
                "target": m.group("target"),
            }
        )
        return result

    # Match send messages: 群发欢迎话术 to some target
    if "群发" in command or "发送" in command:
        # Determine template keyword: 欢迎话术, 产品介绍话术, 跟进话术, 活动通知话术
        template_keyword = None
        for kw in ["欢迎", "产品", "跟进", "活动"]:
            if kw in command:
                template_keyword = kw
                break
        result.update(
            {
                "action": "send_messages",
                "template_keyword": template_keyword,
                # Determine target from command if specified
                "target": None,
            }
        )
        return result

    # Match generate report: 简报/报告
    if "简报" in command or "报告" in command:
        result.update({"action": "generate_report"})
        return result

    # Match stop or pause commands
    if "停止" in command or "终止" in command:
        result.update({"action": "stop"})
        return result
    if "暂停" in command:
        result.update({"action": "pause"})
        return result

    return result


def generate_fake_customers(industry: str, number: int) -> List[Dict[str, Any]]:
    """Generate a list of fake customer dictionaries.

    This helper uses the Faker library to fabricate plausible Chinese
    names, phone numbers and company names.  The resulting records
    mirror the schema expected by the Customer model.  A timestamp
    indicating when the customers were "collected" is attached.

    Parameters
    ----------
    industry: str
        The industry label assigned to the new customers.
    number: int
        The number of customer records to generate.

    Returns
    -------
    List[Dict[str, Any]]
        A list of customer dictionaries ready for insertion into the
        database.
    """
    customers: List[Dict[str, Any]] = []
    for _ in range(number):
        name = fake.name()
        phone = fake.phone_number()
        wechat = fake.user_name()
        qq = str(fake.random_number(digits=9))
        company = fake.company()
        position = fake.job()
        region = fake.province()
        collected_time = dt.datetime.utcnow()
        customers.append(
            {
                "name": name,
                "phone": phone,
                "wechat": wechat,
                "qq": qq,
                "company": company,
                "position": position,
                "industry": industry,
                "region": region,
                "channel": "自动生成",
                "collected_time": collected_time,
                "add_status": "未添加",
                "intention": "无",
                "remarks": None,
            }
        )
    return customers


def render_template_content(template_content: str, customer: Dict[str, Any]) -> str:
    """Replace placeholders in a template with customer data.

    Supported placeholders include ``{客户姓名}``, ``{行业}``, ``{公司}``.
    Additional keys may be added as needed.  If a placeholder is
    missing from the customer record it's replaced by an empty string.
    """
    content = template_content
    placeholders = {
        "客户姓名": customer.get("name") or "",
        "行业": customer.get("industry") or "",
        "公司": customer.get("company") or "",
    }
    for key, value in placeholders.items():
        content = content.replace(f"{{{key}}}", value)
    return content
