import httpx

from validate import validator


async def test_health_returns_ok(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    validator("HealthResponse").validate(response.json())


async def test_cors_allows_configured_origin(client: httpx.AsyncClient) -> None:
    response = await client.options(
        "/api/episodes/stream",
        headers={"Origin": "https://brainrot.example", "Access-Control-Request-Method": "POST"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://brainrot.example"


async def test_cors_rejects_unknown_origin(client: httpx.AsyncClient) -> None:
    response = await client.options(
        "/api/episodes/stream",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )

    assert "access-control-allow-origin" not in response.headers
