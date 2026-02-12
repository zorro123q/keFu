"""Entry point for the marketing automation platform.

This module defines the FastAPI application, configures the routing
logic and implements the core user interface.  The API is
intentionally simple: it does not require authentication and runs
entirely on the user's machine.  In a production environment you
should add authentication, HTTPS and other hardening measures.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from .database import init_db, fetchall, fetchone, execute
from .utils import parse_command, generate_fake_customers, render_template_content


app = FastAPI(title="自动化营销平台", default_response_class=HTMLResponse)

# Mount the static files directory for CSS and JS assets
from pathlib import Path

# Determine the directory containing this file and use it to locate
# the static and templates folders.  ``Path(__file__).resolve()`` is
# used to guard against relative path issues when the application
# is executed from a different working directory.
BASE_DIR = Path(__file__).resolve().parent

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

# Configure Jinja2 templates.  The templates directory lives alongside
# this file.
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@app.on_event("startup")
async def startup() -> None:
    """Initialise the database on application startup."""
    init_db()


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Render the dashboard with a high level overview of activity."""
    total_customers = fetchone("SELECT COUNT(*) as cnt FROM customers")['cnt']
    total_templates = fetchone("SELECT COUNT(*) as cnt FROM templates")['cnt']
    total_messages = fetchone("SELECT COUNT(*) as cnt FROM message_logs")['cnt']
    last_command = fetchone("SELECT * FROM command_logs ORDER BY id DESC LIMIT 1")
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "total_customers": total_customers,
            "total_templates": total_templates,
            "total_messages": total_messages,
            "last_command": last_command,
        },
    )


# -------------------- Customer Management --------------------

@app.get("/customers", response_class=HTMLResponse)
async def list_customers(
    request: Request,
    industry: Optional[str] = None,
    region: Optional[str] = None,
    add_status: Optional[str] = None,
):
    """List customers with optional filtering."""
    base_query = "SELECT * FROM customers WHERE 1=1"
    params: List[Any] = []
    if industry:
        base_query += " AND industry = ?"
        params.append(industry)
    if region:
        base_query += " AND region = ?"
        params.append(region)
    if add_status:
        base_query += " AND add_status = ?"
        params.append(add_status)
    customers = fetchall(base_query + " ORDER BY id DESC", params)
    industries = [row['industry'] for row in fetchall("SELECT DISTINCT industry FROM customers WHERE industry IS NOT NULL") if row['industry']]
    regions = [row['region'] for row in fetchall("SELECT DISTINCT region FROM customers WHERE region IS NOT NULL") if row['region']]
    return templates.TemplateResponse(
        "customers.html",
        {
            "request": request,
            "customers": customers,
            "industries": industries,
            "regions": regions,
            "selected_industry": industry,
            "selected_region": region,
            "selected_status": add_status,
        },
    )


@app.get("/customers/add", response_class=HTMLResponse)
async def add_customer_form(request: Request):
    return templates.TemplateResponse("customer_form.html", {"request": request, "customer": None})


@app.post("/customers/add")
async def add_customer(
    request: Request,
    name: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    wechat: Optional[str] = Form(None),
    qq: Optional[str] = Form(None),
    company: Optional[str] = Form(None),
    position: Optional[str] = Form(None),
    industry: Optional[str] = Form(None),
    region: Optional[str] = Form(None),
    channel: Optional[str] = Form(None),
    intention: Optional[str] = Form("无"),
    remarks: Optional[str] = Form(None),
):
    now = dt.datetime.utcnow().isoformat()
    execute(
        """
        INSERT INTO customers (name, phone, wechat, qq, company, position, industry, region, channel,
                               collected_time, add_status, intention, remarks, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            phone,
            wechat,
            qq,
            company,
            position,
            industry,
            region,
            channel,
            now,
            "未添加",
            intention,
            remarks,
            now,
            now,
        ),
    )
    return RedirectResponse(url="/customers", status_code=303)


@app.get("/customers/edit/{customer_id}", response_class=HTMLResponse)
async def edit_customer_form(customer_id: int, request: Request):
    customer = fetchone("SELECT * FROM customers WHERE id = ?", (customer_id,))
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return templates.TemplateResponse(
        "customer_form.html", {"request": request, "customer": customer}
    )


@app.post("/customers/edit/{customer_id}")
async def edit_customer(
    customer_id: int,
    request: Request,
    name: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    wechat: Optional[str] = Form(None),
    qq: Optional[str] = Form(None),
    company: Optional[str] = Form(None),
    position: Optional[str] = Form(None),
    industry: Optional[str] = Form(None),
    region: Optional[str] = Form(None),
    channel: Optional[str] = Form(None),
    add_status: Optional[str] = Form(None),
    intention: Optional[str] = Form(None),
    remarks: Optional[str] = Form(None),
):
    now = dt.datetime.utcnow().isoformat()
    existing = fetchone("SELECT id FROM customers WHERE id = ?", (customer_id,))
    if not existing:
        raise HTTPException(status_code=404, detail="Customer not found")
    execute(
        """
        UPDATE customers
        SET name=?, phone=?, wechat=?, qq=?, company=?, position=?, industry=?, region=?, channel=?, add_status=?, intention=?, remarks=?, updated_at=?
        WHERE id=?
        """,
        (
            name,
            phone,
            wechat,
            qq,
            company,
            position,
            industry,
            region,
            channel,
            add_status,
            intention,
            remarks,
            now,
            customer_id,
        ),
    )
    return RedirectResponse(url="/customers", status_code=303)


@app.post("/customers/delete/{customer_id}")
async def delete_customer(customer_id: int):
    execute("DELETE FROM customers WHERE id = ?", (customer_id,))
    return RedirectResponse(url="/customers", status_code=303)


# -------------------- Template Management --------------------

@app.get("/templates", response_class=HTMLResponse)
async def list_templates(request: Request):
    templates_list = fetchall("SELECT * FROM templates ORDER BY id DESC")
    return templates.TemplateResponse(
        "templates.html", {"request": request, "templates": templates_list}
    )


@app.get("/templates/add", response_class=HTMLResponse)
async def add_template_form(request: Request):
    return templates.TemplateResponse(
        "template_form.html", {"request": request, "template": None}
    )


@app.post("/templates/add")
async def add_template(
    request: Request,
    name: str = Form(...),
    content: str = Form(...),
    type: Optional[str] = Form(None),
    scene: Optional[str] = Form(None),
    is_active: Optional[str] = Form("1"),
):
    now = dt.datetime.utcnow().isoformat()
    execute(
        """
        INSERT INTO templates (name, content, type, scene, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            content,
            type,
            scene,
            int(is_active),
            now,
            now,
        ),
    )
    return RedirectResponse(url="/templates", status_code=303)


@app.get("/templates/edit/{template_id}", response_class=HTMLResponse)
async def edit_template_form(template_id: int, request: Request):
    template_obj = fetchone("SELECT * FROM templates WHERE id = ?", (template_id,))
    if not template_obj:
        raise HTTPException(status_code=404, detail="Template not found")
    return templates.TemplateResponse(
        "template_form.html",
        {"request": request, "template": template_obj},
    )


@app.post("/templates/edit/{template_id}")
async def edit_template(
    template_id: int,
    request: Request,
    name: str = Form(...),
    content: str = Form(...),
    type: Optional[str] = Form(None),
    scene: Optional[str] = Form(None),
    is_active: Optional[str] = Form("1"),
):
    now = dt.datetime.utcnow().isoformat()
    existing = fetchone("SELECT id FROM templates WHERE id = ?", (template_id,))
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")
    execute(
        """
        UPDATE templates
        SET name=?, content=?, type=?, scene=?, is_active=?, updated_at=?
        WHERE id=?
        """,
        (
            name,
            content,
            type,
            scene,
            int(is_active or "1"),
            now,
            template_id,
        ),
    )
    return RedirectResponse(url="/templates", status_code=303)


@app.post("/templates/delete/{template_id}")
async def delete_template(template_id: int):
    execute("DELETE FROM templates WHERE id = ?", (template_id,))
    return RedirectResponse(url="/templates", status_code=303)


# -------------------- Command Processing --------------------

async def process_command(command_text: str) -> str:
    """Execute a parsed command and return a human‑readable result string.

    This function orchestrates the high level actions described in
    ``utils.parse_command``.  It does not perform any network I/O and
    therefore is safe to call within the request context.  More
    sophisticated implementations could offload long running tasks to
    background workers (e.g. Celery).
    """
    parsed = parse_command(command_text)
    action = parsed.get("action")
    if action == "gather":
        industry = parsed.get("industry")
        number = parsed.get("number", 0)
        new_customers = generate_fake_customers(industry, number)
        now = dt.datetime.utcnow().isoformat()
        for cust_data in new_customers:
            execute(
                """
                INSERT INTO customers (name, phone, wechat, qq, company, position, industry, region, channel,
                                       collected_time, add_status, intention, remarks, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cust_data["name"],
                    cust_data["phone"],
                    cust_data["wechat"],
                    cust_data["qq"],
                    cust_data["company"],
                    cust_data["position"],
                    cust_data["industry"],
                    cust_data["region"],
                    cust_data["channel"],
                    now,
                    cust_data["add_status"],
                    cust_data["intention"],
                    cust_data["remarks"],
                    now,
                    now,
                ),
            )
        return f"已生成{len(new_customers)}个{industry}行业客户信息。"
    elif action == "add_friends":
        target = parsed.get("target")
        # Fetch customers to be updated
        params: List[Any] = []
        query = "SELECT id FROM customers WHERE add_status != '已添加'"
        if target and target != "客户":
            query += " AND industry LIKE ?"
            params.append(f"%{target}%")
        customers = fetchall(query, params)
        count = len(customers)
        if count:
            if target and target != "客户":
                execute(
                    "UPDATE customers SET add_status='已添加' WHERE add_status != '已添加' AND industry LIKE ?",
                    (f"%{target}%",),
                )
            else:
                execute("UPDATE customers SET add_status='已添加' WHERE add_status != '已添加'")
        return f"已将{count}位客户标记为已添加好友。"
    elif action == "send_messages":
        template_keyword = parsed.get("template_keyword")
        template = None
        if template_keyword:
            template = fetchone(
                "SELECT * FROM templates WHERE name LIKE ? ORDER BY id LIMIT 1",
                (f"%{template_keyword}%",),
            )
        if not template:
            template = fetchone(
                "SELECT * FROM templates ORDER BY id LIMIT 1"
            )
        if not template:
            return "尚未配置任何话术模板，无法发送消息。"
        customers = fetchall(
            "SELECT id, name, industry, company FROM customers WHERE add_status = '已添加'"
        )
        sent_count = 0
        now = dt.datetime.utcnow().isoformat()
        for customer in customers:
            content = render_template_content(
                template["content"],
                {
                    "name": customer["name"],
                    "industry": customer["industry"],
                    "company": customer["company"],
                },
            )
            execute(
                """
                INSERT INTO message_logs (customer_id, send_time, send_type, message_content, status, error, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    customer["id"],
                    now,
                    "群发",
                    content,
                    "发送成功",
                    None,
                    now,
                ),
            )
            sent_count += 1
        return f"消息发送完成，共发送给{sent_count}位客户。"
    elif action == "generate_report":
        total = fetchone("SELECT COUNT(*) as cnt FROM customers")['cnt']
        added = fetchone("SELECT COUNT(*) as cnt FROM customers WHERE add_status = '已添加'")['cnt']
        msg_count = fetchone("SELECT COUNT(*) as cnt FROM message_logs")['cnt']
        return f"客户总数：{total}；已添加好友数：{added}；发送消息数：{msg_count}。"
    elif action in ("pause", "stop"):
        return "操作已暂停/终止（模拟）。"
    else:
        return "无法识别的指令，请重试。"


@app.get("/commands", response_class=HTMLResponse)
async def command_page(request: Request):
    logs = fetchall("SELECT * FROM command_logs ORDER BY id DESC LIMIT 20")
    return templates.TemplateResponse(
        "commands.html", {"request": request, "logs": logs}
    )


@app.post("/commands")
async def receive_command(request: Request, command: str = Form(...)):
    # Record the command log
    now = dt.datetime.utcnow().isoformat()
    cmd_id = execute(
        """
        INSERT INTO command_logs (command_content, status, time, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (
            command,
            "执行中",
            now,
            now,
        ),
    )
    start_time = dt.datetime.utcnow()
    standardized = str(parse_command(command))
    try:
        result = await process_command(command)
        status = "执行成功"
        error = None
    except Exception as e:
        result = None
        status = "执行失败"
        error = str(e)
    end_time = dt.datetime.utcnow()
    duration = int((end_time - start_time).total_seconds())
    # Update the command log
    execute(
        """
        UPDATE command_logs
        SET standardized_command=?, result=?, error=?, status=?, duration=?
        WHERE id=?
        """,
        (
            standardized,
            result,
            error,
            status,
            duration,
            cmd_id,
        ),
    )
    return RedirectResponse(url="/commands", status_code=303)


# -------------------- Message and Command Logs --------------------

@app.get("/messages", response_class=HTMLResponse)
async def list_messages(request: Request):
    messages = fetchall(
        "SELECT * FROM message_logs ORDER BY id DESC LIMIT 100"
    )
    return templates.TemplateResponse(
        "messages.html", {"request": request, "messages": messages}
    )


@app.get("/commandlogs", response_class=HTMLResponse)
async def list_command_logs(request: Request):
    logs = fetchall(
        "SELECT * FROM command_logs ORDER BY id DESC LIMIT 100"
    )
    return templates.TemplateResponse(
        "command_logs.html", {"request": request, "logs": logs}
    )


# -------------------- Data Report --------------------

@app.get("/report", response_class=HTMLResponse)
async def report_page(request: Request):
    # Compute summary statistics
    total_customers = fetchone("SELECT COUNT(*) as cnt FROM customers")['cnt']
    added_customers = fetchone("SELECT COUNT(*) as cnt FROM customers WHERE add_status = '已添加'")['cnt']
    total_messages = fetchone("SELECT COUNT(*) as cnt FROM message_logs")['cnt']
    industry_rows = fetchall("SELECT DISTINCT industry FROM customers WHERE industry IS NOT NULL")
    industry_counts: List[tuple[str, int]] = []
    for row in industry_rows:
        ind = row['industry']
        count = fetchone("SELECT COUNT(*) as cnt FROM customers WHERE industry = ?", (ind,))['cnt']
        industry_counts.append((ind, count))
    return templates.TemplateResponse(
        "report.html",
        {
            "request": request,
            "total_customers": total_customers,
            "added_customers": added_customers,
            "total_messages": total_messages,
            "industry_counts": industry_counts,
        },
    )
