from django.urls import path

from . import views

app_name = 'statements'

urlpatterns = [
    path('', views.landing, name='landing'),
    path('workspace/', views.workspace, name='workspace'),
]
